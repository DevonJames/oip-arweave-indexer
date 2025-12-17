/**
 * OIP v0.9.0 Client SDK Type Definitions
 */

export const OIP_PURPOSE: number;
export const OIP_VERSION: string;

export const SubPurpose: {
    IDENTITY_SIGN: number;
    IDENTITY_ENCRYPT: number;
    DELEGATION: number;
    REVOCATION: number;
    JWT: number;
    SSH: number;
    BACKUP: number;
    ONION: number;
    EXPERIMENTAL: number;
};

export interface Profile {
    handle?: string;
    handleRaw?: string;
    name?: string;
    surname?: string;
}

export interface Tag {
    name: string;
    value: string;
}

export interface Fragment {
    id: string;
    dataType: string;
    recordType: string;
    records: Record<string | number, any>[];
}

export interface Payload {
    '@context'?: string;
    tags?: Tag[];
    fragments?: Fragment[];
}

export interface SignedPayload extends Payload {
    tags: Tag[];
}

export class OIPIdentity {
    readonly did: string;
    readonly signingXpub: string;
    readonly account: number;

    constructor(mnemonic: string, account?: number);
    
    sign(payload: Payload): SignedPayload;
    createDidDocument(profile?: Profile): Payload;
    createSignedDidDocument(profile?: Profile): SignedPayload;
    getDerivationPath(): string;
}

export function createNewIdentity(strength?: number, account?: number): {
    identity: OIPIdentity;
    mnemonic: string;
};

export function isValidMnemonic(mnemonic: string): boolean;

export function canonicalJson(obj: any): string;

export function base64urlEncode(bytes: Uint8Array | ArrayBuffer): string;

export function base64urlDecode(str: string): Uint8Array;

export function deriveIndexFromPayloadDigest(payloadDigest: string): number;

export default OIPIdentity;

