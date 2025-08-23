# Migration Proposal: From Arweave Signatures to DID-Based Identity Verification

## Background

Today, OIP creators register themselves by publishing a **creatorRegistration record**. This record includes:

- `address` (Arweave address)
- `publicKey`
- `handle` (with uniqueness suffix derived from txId)
- `surname` and optional social handles
- Optionally, a separate `basic` template for `name`, `language`, etc.

Verification of creator identity is currently anchored in the **Arweave transaction signature**.

This model works but blurs identity (who) and records (what). To better align with standards, we are migrating to **DIDs and DID Documents**.

---

## Proposed Approach

We will adopt **DID-based identity verification** using HD keys:

1. **Creator identity = `did:key`**  
   Each creator’s HD master public key generates a `did:key:<multibase>`. This becomes the **root identity**.

2. **Creator DID Document = New record type**  
   Instead of a “creatorRegistration record,” creators will publish a **didDocument record** anchored on Arweave.  
   This record maps directly into a standards-compliant DID Document:
   - Includes `@context`, `id`, `verificationMethod`, `assertionMethod`, etc.  
   - Embeds an `oip:profile` block for human-readable fields (handle, name, surname, socials).  
   - May link to `basic` and `creatorRegistration` records for provenance via `service`.

3. **Subsequent records = Signed by child keys**  
   Future records are signed by HD-derived child keys. Verification can follow either:
   - **Subkey Binding** (recommended): each child key includes a master-signed binding proof.  
   - **Xpub + path**: the DID Document publishes an xpub, and records include derivation paths.

4. **Record identity = `did:arweave`**  
   Regular OIP records (documents, media, templates) remain referenced by `did:arweave:<txid>` (immutable content drefs).

---

## DID Document Template

We introduce a new `didDocument` template. Example schema:

```json
{
  "didDocument": {
    "did": "string",                   // did:key:...
    "controller": "string",
    "context": "string",               // JSON stringified array of contexts
    "verificationMethod_json": "string",   // JSON stringified array
    "assertionMethod_json": "string",
    "authentication_json": "string",
    "alsoKnownAs_json": "string",
    "service_json": "string",

    "oip_profile_handleRaw": "string", // user-provided
    "oip_profile_handle": "string",    // canonical with uniqueness suffix
    "oip_profile_name": "string",
    "oip_profile_surname": "string",
    "oip_profile_language": "string",
    "oip_profile_x": "string",
    "oip_profile_youtube": "string",
    "oip_profile_instagram": "string",
    "oip_profile_tiktok": "string",

    "proof_type": "string",
    "proof_created": "string",
    "proof_verificationMethod": "string",
    "proof_purpose": "string",
    "proof_jws": "string",

    "anchor_arweave_txid": "string",   // txid of this record
    "key_binding_policy": "string"     // "binding" or "xpub"
  }
}
```

---

## Rendering into a Proper DID Document

A new API endpoint will take this `didDocument` record (plus optional `basic` and legacy `creatorRegistration`) and render a full W3C-compliant DID Document:

```json
{
  "@context": ["https://www.w3.org/ns/did/v1","https://oip.dev/ns/v1"],
  "id": "did:key:z6Mk...",
  "controller": "did:key:z6Mk...",
  "verificationMethod": [ /* from verificationMethod_json */ ],
  "assertionMethod": [ /* from assertionMethod_json */ ],
  "authentication": [ /* from authentication_json */ ],
  "alsoKnownAs": ["handle:Librarian7","did:arweave:<anchor-txid>"],
  "service": [ /* service_json, may link to basic/creatorRegistration drefs */ ],

  "oip:profile": {
    "oip:handleRaw": "Librarian",
    "oip:handle": "Librarian7",  // computed canonical handle
    "oip:name": "Devon",
    "oip:surname": "James",
    "oip:language": "English",
    "oip:social": {
      "x": "@DevonRJames"
    }
  },

  "proof": {
    "type": "DataIntegrityProof",
    "created": "2025-08-22T00:00:00Z",
    "verificationMethod": "did:key:z6Mk...#master-2025",
    "proofPurpose": "assertionMethod",
    "jws": "..."
  }
}
```

---

## Handle Uniqueness

- **Raw handle**: provided in `oip_profile_handleRaw`.  
- **Canonical handle**: derived by your daemon:
  - Take the `anchor_arweave_txid`, strip to hex, parse as decimal, append digits until unique.  
  - Result is stored as `oip_profile_handle`.  
- API and indexers use the canonical handle (`Librarian7`) for uniqueness, while raw is preserved for context.

---

## Migration Steps

1. **Schema Update**
   - Introduce `didDocument` template.  
   - Deprecate creatorRegistration as the root of trust (but keep as metadata).

2. **Identity Publishing**
   - Creators generate HD master key.  
   - Derive `did:key` from master public key.  
   - Publish `didDocument` record to Arweave with inline `oip:profile`.

3. **API Changes**
   - New `/did/:txid` endpoint composes W3C-compliant DID Document JSON from `didDocument` + linked `basic`.  
   - Indexers resolve `issuerDid` → canonical handle.

4. **Verification Flow**
   - Legacy records: verify via Arweave tx signature.  
   - DID-based records: verify using DID Document’s verificationMethod(s).  
   - Child records: validated via Subkey Binding (recommended) or xpub.

5. **Backfill**
   - For existing creators:
     - Generate HD keys and DID Document.  
     - Link old creatorRegistration via `service` or `alsoKnownAs`.  
     - Preserve old handles as aliases, set canonical handle from new DID Document.

---

## Benefits

- **Spec alignment**: OIP creators now have true W3C DID Documents.  
- **Cleaner separation**: `did:key` for identity, `did:arweave` for content.  
- **Inline profile**: `oip:profile` consolidates name, handle, socials inside the DID Document.  
- **Backward compatibility**: legacy creatorRegistration still referenced via `service`.  
- **Extensibility**: supports multiple keys, revocation, delegation, richer metadata.  

---

✅ **Summary:**  
We are upgrading from **Arweave tx signatures** to **HD key–backed DID Documents**. Creators now publish a `didDocument` template, which your API renders into a proper W3C DID Document with inline `oip:profile`. Handles are still unique via the anchor txId method. Existing creatorRegistration/basic templates remain usable for extra metadata but are no longer the identity root.  
