$(document).ready(function()
{

pdfjsLib.GlobalWorkerOptions.workerSrc = "./js/pdf.worker.min.js";

let metadata = null;

function loadMetadataFile(file) {
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            metadata = await SisMetadata.load(event.target.result);

            if (metadata) {
                loadMetadata(file.name);
                applyEventFilters();

                $("#verify-file").modal("hide");
                $("#welcome-page").hide();
                $("#verification-page").show();
            }
        } catch {
            alert("Failed to load file.")
        }
    };
    reader.onerror = function(event) {
        alert("Failed to load metadata file.");
        console.error(reader.error);
    }
    reader.readAsArrayBuffer(file);
}

function loadMetadata(filename) {
    const data = metadata.getData();
    let users = [];
    let eventTypes = [];
    let eventAmounts = {};
    const eventNames = {
        accepting: "Accepting",
        archiving: "Archiving",
        creation: "Creation",
        cancellation: "Cancellation",
        forcedClosing: "Forced Closing",
        voteCasting: "Vote Casting"
    };

    $("#verification-page-files tbody tr").remove();
    $("#verification-page-users tbody tr").remove();
    $("#verification-page-events tbody tr").remove();
    $("#verification-page-filter option").remove();
    $("#verification-page-filename").text(filename);
    $("#verification-page-type").text(data.type.charAt(0).toUpperCase() + data.type.slice(1));
    $("#verification-page-name").text(data.name);
    $("#verification-page-id").text(data.id);
    $("#verification-page-key").text(data.hashKey);

    if (data.type === "folder") {
        for (const user of data.administrators) {
            let roles = ["<strong>Administrator</strong>"];

            if (data.eligibleVoters.includes(user)) {
                roles.push("Voter");
            }

            users.push({id: user, roles: roles});
        }

        eventTypes = ["creation", "accepting", "archiving"];
    } else {
        eventTypes = ["creation", "voteCasting", "cancellation", "forcedClosing"];
    }

    for (const user of data.eligibleVoters) {
        if (data.type !== "folder" || !data.administrators.includes(user)) {
            users.push({id: user, roles: ["Voter"]});
        }
    }

    for (const event of eventTypes) {
        eventAmounts[event] = 0;
    }

    let i = 1

    for (const event of data.events) {
        const id = "verification-page-event-" + i;
        const transaction = metadata.getTransaction(event);

        $("#verification-page-events tbody").append(`<tr data-type="${event.type}">
<td>${i}.</td>
<td>${eventNames[event.type]}</td>
<td>${event.date}</td>
<td>${(transaction && transaction.url) ? `<a href="${transaction.url}" target="_blank">${transaction.id}</a>` : (transaction ? transaction.id : "")}</td>
<td><button type="button" id="${id}" class="btn btn-primary" data-toggle="modal" data-target="#verify-${data.type}-${event.type}">Verify</button></td>
</tr>`);

        $("#" + id).data("event", metadata.getEventData(event));
        $("#" + id).data("transaction", transaction ? transaction.id : null);

        ++eventAmounts[event.type];
        ++i;
    }

    for (const file of data.files) {
        $("#verification-page-files tbody").append(`<tr>
<td>${file.name}</td>
<td>${file.hash}</td>
</tr>`);
    }

    for (const user of users) {
        const email = metadata.getUserEmail(user.id);

        $("#verification-page-users tbody").append(`<tr>
<td>${email ? `<a href="mailto:${email}">${email}</a>` : "•••••"}</td>
<td>${user.id}</td>
<td>${user.roles.join(", ")}</td>
</tr>`);
    }

    for (const event of eventTypes) {
        $("#verification-page-filter").append(`<option value="${event}" data-content="<span class='badge badge-primary'>${eventAmounts[event]}</span> ${eventNames[event]}">${eventNames[event]}</option>`);
    }

    $("#verification-page-filter").selectpicker("refresh");
    $("#verification-page-filter").selectpicker("selectAll");

    return true;
}

function addListItem(list, value, label, allowDuplicates = false) {
    if (!allowDuplicates && list.children(`span[data-value="${value}"]`).length > 0) {
        return;
    }

    list.append(`<span data-value="${value}"${label ? ` data-label="${label}" class="item-toggled"` : ""}>${(label ? `<span class="toggle-item">👁</span><span class="item-label">${label}</span>` : `<span class="item-label">${value}</span>`)} <span class="remove-item">×</span></span>`);
    list[0].dispatchEvent(new Event("change"));
}

function setFieldValue(dialog, field, value) {
    let mapper = null;
    const fieldElement = $(`#${dialog.attr("id")}-${field}`);
    fieldElement.data("default", value);

    if (metadata) {
        switch (field) {
            case "administrators":
            case "voters":
                mapper = metadata.getUserEmail;

                break;
            case "files":
                mapper = metadata.getFilename;
            default:
                break;
        }
    }

    switch (field) {
        case "administrators":
        case "files":
        case "folders":
        case "voters":
            $(`#${dialog.attr("id")}-${field} > span`).remove();

            if (!value) {
                return;
            }

            const allowDuplicates = (field === "files");

            for (const item of value) {
                addListItem(fieldElement, item, (mapper ? mapper.call(metadata, item) : ""), allowDuplicates);
            }

            break;
        default:
            fieldElement.val(value);

            break;
    }
}

function getListItems(list) {
    let items = [];

    list.children("span").each(function(index, element) {
        items.push($(element).data("value"));
    });

    items.sort();

    return items;
}

function getFieldValue(dialog, field) {
    const dialogId = dialog.attr("id");
    const fieldElement = $(`#${dialogId}-${field}`);

    switch (field) {
        case "administrators":
        case "files":
        case "folders":
        case "voters":
            return getListItems(fieldElement).join(",");
        case "vote":
            const fieldValue = fieldElement.val();

            if (dialogId.includes("folder-accepting")) {
                return ((fieldValue === "in-favour") ? 1 : 0);
            }

            if (dialogId.includes("voting-voteCasting")) {
                return fieldValue.toUpperCase();
            }

            break;
        default:
            break;
    }

    return fieldElement.val();
}

function applyEventFilters() {
    const filters = $("#verification-page-filter").val();

    $("#verification-page-events tbody tr").each(function(index, element) {
        const rowElement = $(element);
        rowElement.css("display", (filters.includes(rowElement.attr("data-type")) ? "table-row" : "none"));
    });
}

function compareResults(actualResultField) {
    const expectedResultField = ($("#" + actualResultField.attr("id").replace("-actual", "-expected")));
    const indicatorElement = $("#" + actualResultField.attr("id").replace("-actual", "-indicator"));
    const alertElement = indicatorElement.closest(".alert");
    const isEmpty = (actualResultField.val() === "" || expectedResultField.val() === "");
    const isMatching = (actualResultField.val() === expectedResultField.val());

    indicatorElement.removeClass(["text-success", "text-danger"]);
    indicatorElement.text((isEmpty || isMatching) ? "=" : "≠");

    alertElement.removeClass(["alert-secondary", "alert-success", "alert-danger"]);

    if (isEmpty) {
        alertElement.addClass("alert-secondary")
    } else {
        indicatorElement.addClass(isMatching ? "text-success" : "text-danger");

        alertElement.addClass(isMatching ? "alert-success" : "alert-danger")
    }
}

async function calculateVerification(dialog, format, version) {
    let rawValues = {};

    for (const component of format) {
        if (Array.isArray(component)) {
            for (const hashedComponent of component) {
                rawValues[hashedComponent] = getFieldValue(dialog, hashedComponent);
            }
        } else {
            rawValues[component] = getFieldValue(dialog, component);
        }
    }

    return await SisMetadata.calculateVerification($(`#${dialog.attr("id")}-key`).val(), format, version, rawValues);
}

$("button[data-reset-target]").each(function(index, element) {
    const field = $($(element).attr("data-reset-target"));
    const defaultValue = field.data("default");

    if (field.hasClass("item-list")) {
        field.change(function() {
            $(element).prop("disabled", (getListItems(field).join(",") === (defaultValue ? defaultValue.join(",") : "")));
        });
    } else {
        field.on("change paste keyup", function() {
            $(element).prop("disabled", (field.val() === defaultValue));
        });
    }
});

$(".link-home").click(function() {
    $("#verification-page").hide();
    $("#welcome-page").show();
});

$(".item-list").on("click", "span .toggle-item", function() {
   const itemElement = $(this).parent();
   itemElement.children(".item-label").text(itemElement.attr("data-" + (itemElement.hasClass("item-toggled") ? "value" : "label")));
   itemElement.toggleClass("item-toggled");
});

$(".item-list").on("click", "span .remove-item", function() {
    const list = $(this).parent().parent();

    $(this).parent().remove();

    list[0].dispatchEvent(new Event("change"));
});

$("button[data-reset-target]").click(function() {
    const fieldElement = $($(this).attr("data-reset-target"));
    const fieldId = fieldElement.attr("id");
    const index = fieldId.lastIndexOf("-");

    setFieldValue($("#" + fieldId.slice(0, index)), fieldId.slice(index + 1), fieldElement.data("default"));

    $(this).prop("disabled", true);
});

$("button[data-toggle-target]").click(function() {
    const toggleElement = $(this);
    const fieldElement = $(toggleElement.attr("data-toggle-target"));
    const fieldPreviewElement = $(toggleElement.attr("data-toggle-target") + "-preview");

    if (toggleElement.hasClass("item-toggled")) {
        toggleElement.removeClass("item-toggled");
        fieldElement.css("display", "inline-block");
        fieldPreviewElement.css("display", "none");
    } else {
        toggleElement.addClass("item-toggled");
        fieldElement.css("display", "none");
        fieldPreviewElement.css("display", "inline-block");
    }
});

$("#actions .btn-primary").on("dragenter dragover", function(event) {
    event.preventDefault();
    event.stopPropagation();
});

$("#actions .btn-primary").on("drop", function(event) {
    if (event.originalEvent.dataTransfer && event.originalEvent.dataTransfer.files.length > 0) {
        event.preventDefault();
        event.stopPropagation();

        loadMetadataFile(event.originalEvent.dataTransfer.files[0]);
    }
});

$("#verification-page-filter").change(function() {
    applyEventFilters();
});

$("#create-file-hash-calculate").click(function() {
    const reader = new FileReader();
    reader.onload = async function(event) {
        $("#create-file-hash-hash").val(await SisCrypto.calculateSha256(event.target.result));
    };
    reader.onerror = function(event) {
        alert("Failed to load file.");
        console.error(reader.error);
    }
    reader.readAsArrayBuffer($("#create-file-hash-file")[0].files[0]);
});

$("#create-file-hash-file").change(function() {
    $("#create-file-hash-hash").val("");
});

$("#create-file-hash-copy").click(function() {
    $("#create-file-hash-hash").select();

    document.execCommand("copy");
});

$("#verify-file-load").click(function() {
    loadMetadataFile(($("#verify-file-file")[0].files[0]));
});

$("#create-file-hash").on("show.bs.modal", function() {
    $("#create-file-hash-hash").val("");
});

$("div[id^=\"verify-folder-\"], div[id^=\"verify-voting-\"]").on("show.bs.modal", async function(event) {
    const trigger = $(event.relatedTarget);
    const eventData = trigger.data("event");
    const dialogId = trigger.attr("data-target");
    const dialog = $(dialogId);

    $(`${dialogId} .item-list > span`).remove();
    $(`${dialogId} .alert`).removeClass(["alert-success", "alert-danger"]);
    $(`${dialogId} .alert`).addClass('alert-secondary');
    $(`${dialogId}-result-actual, ${dialogId}-result-expected`).val("");
    $(`${dialogId}-result-expected`).prop("readonly", !!eventData);
    $(`${dialogId}-result-indicator`).removeClass(["text-success", "text-danger"]);
    $(`${dialogId}-result-indicator`).text("=");
    $(`${dialogId}-invoker`).prop("readonly", !!eventData);
    $(`${dialogId}-invoker`).css("display", (eventData ? "none" : "inline-block"));
    $(`${dialogId}-invoker-preview`).css("display", (eventData ? "inline-block" : "none"));
    $(`${dialogId} button[data-reset-target$="-invoker"]`).css("display", (eventData ? "none" : "inline-block"));
    $(`${dialogId} button[data-toggle-target$="-invoker"]`).css("display", (eventData ? "inline-block" : "none"));

    if (!eventData) {
        $(`${dialogId} .item-list`).data("default", null);
        $(`${dialogId} input, ${dialogId} select`).data("default", null);
        $(`${dialogId} input:not([id$="-operation"]), ${dialogId} select`).val("");
        $(`${dialogId} button[data-reset-target]`).prop("disabled", true);

        return;
    }

    for (const [field, value] of Object.entries(eventData)) {
        setFieldValue(dialog, field, value);
    }

    $(`${dialogId}-invoker-preview`).val(metadata ? metadata.getUserEmail($(`${dialogId}-invoker`).val()) : "");
    $(`${dialogId} button[data-reset-target]`).prop("disabled", true);
    $(`${dialogId} button[data-toggle-target$="-invoker"]`).addClass("item-toggled");

    if (metadata && trigger.data("transaction")) {
        const expectedResult = await metadata.getEventVerificationCode(trigger.data("transaction"));

        if (expectedResult) {
            $(`${dialogId}-result-expected`).val(expectedResult);
        }
    }
});

$("div.modal[id^=\"verify-folder-\"] button.btn-primary, div.modal[id^=\"verify-voting-\"] button.btn-primary").click(async function() {
    const dialog = $(this).closest("div.modal");
    const components = dialog.attr("id").split("-");
    const format = SisMetadata.getVerificationFormat(components[1], components[2]);
    const actualResultField = $(`#${dialog.attr("id")}-result-actual`);
    actualResultField.val(format ? await calculateVerification(dialog, format, "0") : "");

    compareResults(actualResultField);
});

$("div.modal[id^=\"verify-folder-\"] button[id$=\"-add\"], div.modal[id^=\"verify-voting-\"] button[id$=\"-add\"]").click(function() {
    const fieldId = $(this).attr("id");
    const value = $("#" + fieldId.replace("-add", "-new")).val().trim();

    if (value !== "") {
        addListItem($("#" + fieldId.replace("-add", "")), value, "",  fieldId.includes("-files-"));
    }
});

$("div.modal[id^=\"verify-folder-\"] input[id$=\"-upload\"], div.modal[id^=\"verify-voting-\"] input[id$=\"-upload\"]").change(function() {
    const fieldId = $(this).attr("id");
    const reader = new FileReader();
    reader.onload = async function(event) {
        $("#" + fieldId.replace("-upload", "-new")).val(await SisCrypto.calculateSha256(event.target.result));
    };
    reader.onerror = function(event) {
        alert("Failed to load file.");
        console.error(reader.error);
    }
    reader.readAsArrayBuffer($(this)[0].files[0]);
});

$("div.modal[id^=\"verify-folder-\"] input[id$=\"-actual\"], div.modal[id^=\"verify-voting-\"] input[id$=\"-actual\"]").on("change paste keyup", function() {
    compareResults($(this));
});

$("div.modal[id^=\"verify-folder-\"] input[id$=\"-expected\"], div.modal[id^=\"verify-voting-\"] input[id$=\"-expected\"]").on("change paste keyup", function() {
    const field = $(this);

    if (!field.prop("readOnly")) {
        compareResults($("#" + field.attr("id").replace("-expected", "-actual")));
    }
});

});
