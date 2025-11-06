Consider all of the files in your knowledge, as well as this proposal that is being implemented over the next 3 weeks:

Ability
Allow paying for someone else’s message (In Progress)
Allow for creating but not sending a message, instead returning the signed message to be forwarded on. (In Progress)
Sign with a different type of private key. (Proposal below) 
We should have an OIP signing key standard that is separate from the chain key.
This way a message going into Arweave is identical to one going into another chain
Key Type / Signature algo - bytes
Verify a message is signed by the creator’s key that’s in the creator’s record.
Allow for updates for creator records

Routes
Post already filled out and signed message.

Additional Fields for creators
Message server addresses
Multiple signing keys

Bugs
Bug when creating a new creator

Migration Proposal: From Arweave Signatures to DID-Based Identity Verification
Background
Today, OIP creators register themselves by publishing a creatorRegistration record. This record includes:
address (Arweave address)
publicKey
handle (with uniqueness suffix derived from txId)
surname and optional social handles
(Optionally) a separate basic template for name, language, etc.
Verification of creator identity is currently anchored in the Arweave transaction signature.
This model works, but blurs identity (who) and records (what). To align with emerging standards and improve key security, OIP will migrate to DIDs and DID Documents.

Concerns Raised
Master “head” BIP32 key must never be used directly. Exposing the master key in DID docs would be catastrophic if ever compromised.
Sub-purpose derivations are essential. Like in Phil’s implementation for InvertedTech, each purpose (auth, backup, SSH, JWT, onion, delegation, revocation) should use a distinct hardened derivation path.
Rolling / burnable keys. We should support automatic key rollover so that once a new child key is used, old keys are considered revoked.
Read-only xpubs. Like Bitcoin wallets, OIP should allow publishing “read-only” xpubs that can derive child public keys for verification without revealing private material.
SLIP-0044 vs SLIP-0043. SLIP-0044 is for coins. OIP is not a coin, so registering an index there is questionable. Instead, we should use SLIP-0043 custom purpose paths, which were designed for application-specific derivation schemes.

Proposed Approach
1. Identity Root = DID from HD Master Public Key
Each creator generates an HD wallet seed.
The master public key only is converted into a did:key:<multibase> identifier.
This becomes the root DID and anchor of the identity.
The master private key never leaves the user’s machine.
2. DID Document Record
Replace creatorRegistration with a didDocument record anchored on Arweave.
The schema matches W3C DID core plus OIP extensions:
@context, id, controller, verificationMethod, assertionMethod, authentication, service, etc.
Inline oip:profile (handle, name, socials, etc.).
Binding to did:arweave:<txid> for provenance.
3. Child Keys for All Operations
Never sign with master key.
Each DID Document declares verification methods tied to hardened child keys derived via SLIP-0043 paths.
Example path:
m / 43' / 176800' / sub-purpose' / acct’ / index


43' = SLIP-0043 custom purpose
3618' = namespace for OIP (provisional, not SLIP-0044 registered since OIP is not a coin)
sub-purpose' = hardened index (e.g., 0 = auth, 1 = delegation, 2 = revocation, 3 = JWT, 4 = backup, etc.)
acct’ = discrete accounts number from 0 - infinity (multiple identity)
index  = per-record hardened index (often derived deterministically from Arweave txId or DID suffix).
This ensures purpose isolation: compromise of one child key doesn’t compromise others.
The xpub key that gets deployed on the creator record (DID xpub signing key) is:
m / 43' / 176800' / purpose' / acct’
4. Key Rollover and Burn Rules
DID Document includes multiple child public keys with a rolling policy.
Rule: once a new key is used, all previous keys are automatically burned/revoked.
This allows rotation without central coordination.
Old signatures remain verifiable but old keys cannot be reused for future publishing.
5. Read-Only xpub Support
DID Document can optionally publish a “read-only” xpub for a given purpose branch.
Indexers and verifiers can derive valid public subkeys without learning any private keys.
This matches Bitcoin’s HD wallet model: master private stays offline, xpub allows derivation + verification.

DID Document Template
{
  "didDocument": {
    "did": "string",                  
    "controller": "string",
    "context": "string",
    "verificationMethod_json": "string",
    "assertionMethod_json": "string",
    "authentication_json": "string",
    "alsoKnownAs_json": "string",
    "service_json": "string",

    "oip_profile_handleRaw": "string",
    "oip_profile_handle": "string",
    "oip_profile_name": "string",
    "oip_profile_surname": "string",
    "oip_profile_language": "string",
    "oip_profile_x": "string",

    "proof_type": "string",
    "proof_created": "string",
    "proof_verificationMethod": "string",
    "proof_purpose": "string",
    "proof_jws": "string",

    "anchor_arweave_txid": "string",
    "key_binding_policy": "binding|xpub|rolling"
  }
}


Migration Steps
Schema Update – introduce didDocument template, deprecate creatorRegistration as root.
Identity Publishing – master pubkey → did:key, child key(s) → verificationMethods.
API Support – /did/:txid endpoint renders W3C DID. Add support for xpub-based verification.
Verification Flow – records must be signed by hardened subkeys, validated via DID doc.
Backfill – creators can issue DID Documents linking old creatorRegistrations as aliases.

Benefits
Security: Master key never used; hardened paths isolate purposes; automatic key rollover.
Standards Alignment: SLIP-0043 for custom paths; W3C DID compliance.
Extensibility: Delegation, revocation, backups, and special-purpose keys built in.
Resilience: Read-only xpubs enable safe verification without private key leakage.
Migration-Friendly: Legacy creatorRegistration remains valid but subordinate.

Summary
OIP should not register under SLIP-0044 (coins). Instead, it should define a SLIP-0043 custom purpose path for “OIP Identity.” DID Documents anchor on the master public key (did:key), while all publishing and signing uses hardened child keys derived for specific purposes. This protects the master key, allows delegation/revocation, supports backup and rolling encryption strategies, and aligns OIP identity with global DID standards.


OIP HD Key Derivation Specification (Draft v0.2)
1) Derivation model (recap)
Root: BIP-39 → BIP-32 (ed25519 / slip10).
Purpose (SLIP-0043 custom): 176800' (OIP namespace).
Base path:
m / 176800' / <sub-purpose'>' / <account>' / <index>
sub-purpose' — hardened sub-purpose (table below).
account' — hardened account separation (default 0').
<index> — per-use leaf (non-hardened for xpub verification; hardened if using binding proofs).

Sub-purposes
sub-purpose'
name
Use
0'
identity.sign
DID assertion/authentication keys
1'
identity.encrypt
DID keyAgreement (x25519)
2'
delegation
Delegate capability keys
3'
revocation
Revoke/expire other keys
4'
jwt
App / API tokens
5'
ssh
SSH login keys
6'
backup
Rolling backup encryption
7'
onion
Tor onion service identity
8'
experimental
Future expansion

Index policy for per-record keys
index = uint31( SHA256("oip:" + txId) ) for record-linked keys.
Use non-hardened index if you want verifiers to derive the child pubkey from an xpub.
Use hardened index if you prefer privacy; then provide a binding attestation signed by a parent key listed in the DID Document.
2) New OIP templates
2.1 didVerificationMethod template (one VM per record)
Typed fields mirror W3C DID VM plus OIP derivation policy.
{
  "didVerificationMethod": {
    "vm_id": "string",                       // fragment or full DID URL (e.g., "#sign-0")
    "vm_type": "enum",                       // e.g., Ed25519VerificationKey2020, 
X25519KeyAgreementKey2020, JsonWebKey2020, oip:XpubDerivation2025
    "controller": "string",                  // DID of controller; usually self
    "publicKeyMultibase": "string",          // for 2020 key formats
    "publicKeyJwk_json": "string",           // stringified JWK if JsonWebKey2020
    "xpub": "string",                        // optional: publish xpub for derivation 
verification
    "derivation_sub_purpose": "enum",        // maps to table above (sign, encrypt, etc.)
    "derivation_account": "uint64",          // numeric value for account (hardened at path 
level)
    "derivation_pathPrefix": "string",       // e.g., "m/176800'/0'/0'" (informational)
    "leaf_indexPolicy": "enum",              // "txid_hash" | "sequential" | "fixed"
    "leaf_indexFixed": "uint64",             // used only if policy == fixed
    "leaf_hardened": "bool",                 // true => needs binding proof
    "created": "string",                     // ISO8601
    "expires": "string",                     // optional ISO8601
    "revoked": "bool",                       // soft flag; revocations also recorded separately
    "bindingProof_jws": "string",            // optional: master-signed proof binding this VM to 
DID
    "bindingProof_purpose": "enum"           // "assertionMethod" by default
  }
}

Notes
• If vm_type = "oip:XpubDerivation2025", xpub must be present and leaf_hardened should be false.
• If leaf_hardened = true, omit xpub and include bindingProof_jws.


2.2 didDocument template (lightweight DID doc wrapper)
Holds pointers to VMs (as repeated drefs) and inline profile.
{
  "didDocument": {
    "did": "string",
    "controller": "string",
    "verificationMethod": "repeated dref",   // drefs to didVerificationMethod records
    "authentication": "repeated string",     // "#id" fragments (must match a VM)
    "assertionMethod": "repeated string",
    "keyAgreement": "repeated string",
    "service_json": "string",                // stringified array
    "alsoKnownAs": "repeated string",

    "oip_handleRaw": "string",
    "oip_handle": "string",
    "oip_name": "string",
    "oip_surname": "string",
    "oip_language": "string",
    "oip_social_x": "string",
    "oip_social_youtube": "string",
    "oip_social_instagram": "string",
    "oip_social_tiktok": "string",

    "anchor_arweave_txid": "string",         // txId of this didDocument record
    "key_binding_policy": "string"           // "xpub" | "binding"
  }
}

This keeps our existing templated fields approach (e.g., name in basic, surname + handle here). The API endpoint will compose these into a W3C DID Document with an inline oip:profile.


3) API assembly → W3C DID Document
Resolver flow:
Load didDocument record by dref or DID.
Load each referenced didVerificationMethod record.
Emit:
@context, id, controller.
verificationMethod: one entry per VM (convert mbkey/JWK/xpub as appropriate).
authentication, assertionMethod, keyAgreement arrays (from the template).
service (parsed from service_json).
oip:profile block from the oip_* fields.
Proof of the document itself is the Arweave anchor + (optionally) a top-level DataIntegrity proof if you want double-signing.
4) Verification of OIP record signatures
Given a record anchored at txId and signed by key K:
Signature algorithm
Assemble the document to be signed in the final DataForSignature object with all the records and tags (except the CreatorSig tag).  
Turn the DataForSignature into json text.
Hash the json text using SHA256
Sign the hash with the current private key using the Secp256k1 ECDsa signing algorithm (rfc8812 #3.2)
Encode the resulting signature using Base64 Url encoding (rfc4648 #5)
Add to the list of tags name:“CreatorSig”, value: base64url.encode(signature)
Signature verification
Using the xpub, derive the current index

Path A — xpub mode (non-hardened leaf)
Select a VM where vm_type = oip:XpubDerivation2025 (sub-purpose = identity.sign).
Compute index = uint31( SHA256("oip:" + txId) ).
Derive child pubkey from xpub at <index>.
Verify signature with derived pubkey.
Path B — binding mode (hardened leaf)
Select a VM with leaf_hardened = true and a bindingProof_jws.
Verify the binding JWS using a parent key present in verificationMethod.
Verify the record signature with the VM’s public key.
Rotation: adopt the rule “once index N is used, all < N are burned.” The resolver should ignore older indexes when a newer one is observed.


5) Examples
5.1 VM: xpub-based, non-hardened leaf
{
  "didVerificationMethod": {
    "vm_id": "#sign",
    "vm_type": "oip:XpubDerivation2025",
    "controller": "did:key:z6Mk...",
    "xpub": "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKp...",
    "derivation_sub_purpose": "identity.sign",
    "derivation_account": 0,
    "derivation_pathPrefix": "m/176800'/0'/0'",
    "leaf_indexPolicy": "txid_hash",
    "leaf_hardened": false,
    "created": "2025-08-22T00:00:00Z"
  }
}

5.2 VM: hardened leaf with binding
{
  "didVerificationMethod": {
    "vm_id": "#sign-h",
    "vm_type": "Ed25519VerificationKey2020",
    "controller": "did:key:z6Mk...",
    "publicKeyMultibase": "z6MkfY...child",
    "derivation_sub_purpose": "identity.sign",
    "derivation_account": 0,
    "derivation_pathPrefix": "m/176800'/0'/0'",
    "leaf_indexPolicy": "txid_hash",
    "leaf_hardened": true,
    "bindingProof_jws": "eyJhbGciOiJFZERTQSJ9....",
    "created": "2025-08-22T00:00:00Z"
  }
}

5.3 DID Document (references the VMs)
{
  "didDocument": {
    "did": "did:key:z6Mk...",
    "controller": "did:key:z6Mk...",
    "verificationMethod": [
      "dref:arweave:...VM_XPUB_TX",
      "dref:arweave:...VM_HARD_TX"
    ],
    "authentication": ["#sign"],
    "assertionMethod": ["#sign", "#sign-h"],
    "keyAgreement": [],
    "alsoKnownAs": ["handle:Librarian7"],
    "oip_handle": "Librarian7",
    "oip_name": "Devon",
    "oip_surname": "James",
    "oip_language": "English",
    "oip_social_x": "@DevonRJames",
    "anchor_arweave_txid": "TE6Q_RLAuVpC...",
    "key_binding_policy": "xpub"
  }
}

5.4 Example signature generation
Given xpub + document, the process and output would be…

6) Security notes
Never expose or use the root/master private key for routine signing.
Master keys sign attestations (delegation, revocation, VM binding) only.
Server-side “read-only” workflows: publish an xpub for backup (sub-purpose 6'), let servers encrypt; only the user can decrypt with master.
If a hot key is compromised, publish a new VM (higher index/rollover) and mark the old VM revoked:true(and/or issue a revocation entry).
Appendix
v 0.9.0 templates
creatorRegistration
{
  "handle": "string",
  "index_handle": 0,
  "surname": "string",
  "index_surname": 1,
  "signingXpub": "string",
  "index_signingXpub": 2,
  "delegationXpub": "string",
  "index_delegationXpub": 3,
  "revocationList": "repeated string",
  "index_revocationList": 4
}
socialMedia
{
  "website": "repeated dref",
  "index_website": 0,
  "youtube": "repeated dref",
  "index_youtube": 1,
  "x": "string",
  "index_x": 2,
  "instagram": "repeated string",
  "Index_instagram": 3,
  "tiktok": "repeated string",
  "index_tiktok": 4
}
communication
{
  "phone": "repeated string",
  "index_phone": 0,
  "email": "repeated string",
  "index_email": 1,
  "signal": "repeated string",
  "index_signal": 2

}

Synthesize all of this info and use it to pitch OIP as the foundation for a project:

Brewster Khale of the internet archive wants "a potentially cool project.

Yeah he explained it as a dweb project that would support anonymous & uncensorable publishing   

He said using onion & Wordpress 

Meaning tor"

its purpose is to be a safe method for whisteblowers or people with research that could disrupt entrenched industries to do so anonymously in such a way that they'll know what they publish CANNOT be censored, and can be discovered by others who want to see it. imo, it wouldnt be hard to add onion/tor support to OIP so that a given node can be used via onion routing, and by combining this with the proposal for that node to pay for the blockchain fees, publishing can be truly anonymous.

What are all of the best selling points for OIP to be the foundation for this project, and also, on top of the core requirements they've described, what extra benefits would they get by choosing to use OIP (like Alfred as a locally hosted AI/RAG that answers questions about the records in OIP)

extra background, OIP started as the Decentralized Library of Alexandria in 2014, it was the first time anyone ever combined the best aspects of a distributed network like BitTorrent and a decentralized chain of data like Bitcoin by publishing a media file over the BitTorrent network and storing its description, other metadata and its magnet link in a Proof of Work blockchain. DLOA was presented at the first DWeb conference in 2016 and Sir Tim Berners Lee called it thrilling. since then it was used in experiments/proofs of concept to store scientific data by a lab at Caltech, property records by multiple counties in Wyoming (and many others around the world since then), music publishing by Imogen Heap, and a project has been in development for sometime now that will make it the publishing backend for WeAreChange.org and TimCast.com.