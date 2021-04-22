const METADATA_VERSION = "1";

class SisMetadata
{

constructor(data) {
    if (data.type !== "folder" && data.type !== "voting") {
        console.error("Invalid metadata type.");

        throw new Error("Invalid metadata type.");
    }

    if (data.version !== METADATA_VERSION) {
        console.log("Unsupported metadata format version.");

        throw new Error("Unsupported metadata format version.");
    }

    this.data = data;
    this.blockchainId = null;
    this.blockchainDetails = null;
    this.filesMap = {};
    this.usersMap = {};

    let blockchainId = null;

    if ("blockchains" in data) {
        for (const blockchain of data.blockchains) {
            if (blockchain.type === "waves") {
                this.blockchainId = blockchain.id;
                this.blockchainDetails = blockchain.details;

                break;
            }
        }
    }

    for (const file of data.files) {
        this.filesMap[file.hash] = file.name;
    }

    for (const user of data.users) {
        this.usersMap[user.id] = user.name;
    }
}

static async load(fileBuffer) {
    let metadataBuffer = null;

    if (new TextDecoder().decode(fileBuffer.slice(0, 4)) === "%PDF") {
        const document = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
        const attachments = await document.getAttachments();

        if (!("metadata.json" in attachments)) {
            console.error("Document does not include metadata file.")

            return null;
        }

        metadataBuffer = attachments["metadata.json"].content;
    } else {
        metadataBuffer = fileBuffer;
    }

    try {
        const rawData = new TextDecoder().decode(metadataBuffer);
        const data = JSON.parse(rawData);

        if (await this.verifyChecksum(data, rawData)) {
            return new SisMetadata(data);
        }
    } catch {
        console.error("Not a valid JSON file.");

        return null;
    }

    return null;
}

static async verifyChecksum(data, rawData) {
    if (!("checksum" in data)) {
        console.error("Missing checksum.");

        return false;
    }

    const actualChecksum = data.checksum;
    const expectedChecksum = await SisCrypto.calculateSha256(SisCrypto.stringToBuffer(rawData.replace(`"checksum": "${actualChecksum}"`, "\"checksum\": \"SHA256CHECKSUM\"")));

    if (expectedChecksum !== actualChecksum) {
        console.error(`Invalid checksum.\nExpected checksum: ${expectedChecksum}\nActual checksum: ${actualChecksum}`);

        return false;
    }

    return true;
}

getData() {
    return this.data;
}

getFilename(hash) {
    if (hash in this.filesMap) {
        return this.filesMap[hash];
    }

    return null;
}

getUserEmail(id) {
    if (id in this.usersMap) {
        return this.usersMap[id];
    }

    return null;
}

getEventData(event) {
    let eventData = {};

    if (this.data.type === "folder") {
        switch (event.type) {
            case "creation":
                eventData = {
                    name: this.data.name,
                    deadline: this.data.deadline,
                    administrators: this.data.administrators,
                    voters: this.data.eligibleVoters,
                    files: this.data.files.map(function(value) {
                        return value.hash;
                    })
                };

                break;
            case "accepting":
                eventData = {
                    id: this.data.id,
                    vote: event.vote
                };

                break;
            case "archiving":
                eventData = {
                    folders: event.folderIds
                };

                break;
            default:
                return null;
        }
    } else if (this.data.type === "voting") {
        switch (event.type) {
            case "creation":
                eventData = {
                    name: this.data.name,
                    proceedings: this.data.proceedingsId,
                    voters: this.data.eligibleVoters,
                    files: this.data.files.map(function(value) {
                        return value.hash;
                    })
                };

                break;
            case "voteCasting":
                eventData = {
                    id: this.data.id,
                    vote: event.vote.type,
                    inFavourCommon: event.vote.inFavourCommon,
                    inFavourPreferred: event.vote.inFavourPreferred,
                    abstainCommon: event.vote.abstainCommon,
                    abstainPreferred: event.vote.abstainPreferred,
                    againstCommon: event.vote.againstCommon,
                    againstPreferred: event.vote.againstPreferred,
                    amount: event.vote.amount
                };

                break;
            case "cancellation":
                eventData = {
                    id: this.data.id
                };

                break;
            case "forcedClosing":
                eventData = {
                    id: this.data.id
                };

                break;
            default:
                return null;
        }
    }

    eventData.key = this.data.hashKey;
    eventData.invoker = event.invokerId;

    return eventData;
}

async getEventVerificationCode(transactionId) {
    const response = await fetch(`${this.blockchainDetails.nodeUrl}/transactions/info/${transactionId}`);

    if (response.ok) {
        const data = await response.json();

        if ("data" in data) {
            return data.data[0].value;
        }
    }

    return null;
}

getTransaction(event) {
    const transaction = event.transactions.find(function(transaction) {
        return (transaction.blockchainId === this.blockchainId);
    }, this);

    if (!transaction || transaction.blockchainId !== this.blockchainId) {
        return null;
    }

    let url = null;

    if (this.blockchainDetails.explorerUrlPattern) {
        url = this.blockchainDetails.explorerUrlPattern.replace("${transactionId}", transaction.transactionId);
    }

    return {
        id: transaction.transactionId,
        url: url
    };
}

static getVerificationFormat(eventCategory, eventType) {
    if (eventCategory === "folder") {
        switch (eventType) {
            case "creation":
                return ["operation", "invoker", ["name", "deadline", "files", "voters", "administrators"]];
            case "accepting":
                return ["operation", "invoker", "id", "vote"];
            case "archiving":
                return ["operation", "invoker", "folders"];
        }
    } else if (eventCategory === "voting") {
        switch (eventType) {
            case "creation":
                return ["operation", "invoker", ["proceedings", "name", "files", "voters"]];
            case "voteCasting":
                return ["operation", "invoker", ["id", "inFavourCommon", "abstainCommon", "againstCommon", "inFavourPreferred", "abstainPreferred", "againstPreferred", "amount", "vote", "invoker"]];
            case "cancellation":
                return ["operation", "invoker", "id"];
            case "forcedClosing":
                return ["operation", "invoker", "id"];
        }
    }

    return null;
}

static async calculateVerification(key, format, version, rawValues) {
    let values = [];

    for (const component of format) {
        if (Array.isArray(component)) {
            let hashedValues = [];

            for (const hashedComponent of component) {
                hashedValues.push(rawValues[hashedComponent]);
            }

            values.push(await SisCrypto.calculateHmacSha256(SisCrypto.stringToBuffer(key), SisCrypto.stringToBuffer(hashedValues.join('|'))));
        } else {
            values.push(rawValues[component]);
        }
    }

    return values.join('|') + '@' + version;
}

}
