class SisCrypto
{

static stringToBuffer(string) {
    if (typeof TextEncoder === "function") {
        return new TextEncoder().encode(string);
    }

    let array = new Array(string.length);

    for (let i = 0; i < string.length; ++i) {
        array[i] = string.charCodeAt(i) & 0xFF;
    }

    return new Uint8Array(array).buffer;
}

static async calculateSha256(data) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));

    return Array.prototype.map.call(new Uint8Array(digest), function(item) {
        return ("00" + item.toString(16)).slice(-2);
    }).join("");
}

static async calculateHmacSha256(key, data) {
    const importedKey = await window.crypto.subtle.importKey("raw", key, {
        name: "HMAC",
        hash: {
            name: "SHA-256"
        }
    }, false, ["sign", "verify"]);
    const signature = await window.crypto.subtle.sign("HMAC", importedKey, data);

    return btoa(Array.prototype.map.call(new Uint8Array(signature), function(value) {
        return String.fromCharCode(value);
    }).join("")).replace(/\+/g, "-").replace(/\//g, "_");
}

}
