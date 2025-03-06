const LitJsSdk = require('@lit-protocol/sdk-nodejs');

const litNodeClient = new LitJsSdk.LitNodeClient();
litNodeClient.connect();

const chain = 'polygon';

async function encryptContent(content, accessControlConditions) {
    const authSig = await LitJsSdk.checkAndSignAuthMessage({ chain });
    
    const { encryptedString, symmetricKey } = await LitJsSdk.encryptString(content);

    const encryptedSymmetricKey = await litNodeClient.saveEncryptionKey({
        accessControlConditions,
        symmetricKey,
        authSig,
        chain,
    });

    return {
        encryptedContent: encryptedString,
        encryptedSymmetricKey: LitJsSdk.uint8arrayToString(encryptedSymmetricKey, "base16")
    };
}

async function decryptContent(encryptedContent, encryptedSymmetricKey, accessControlConditions) {
    const authSig = await LitJsSdk.checkAndSignAuthMessage({ chain });

    const symmetricKey = await litNodeClient.getEncryptionKey({
        accessControlConditions,
        toDecrypt: encryptedSymmetricKey,
        chain,
        authSig
    });

    const decryptedString = await LitJsSdk.decryptString(
        encryptedContent,
        symmetricKey
    );

    return decryptedString;
}

module.exports = {
    encryptContent,
    decryptContent
}; 