# Lapis Obscura: Product Requirements Document

**Version:** 1.0  
**Date:** Nov 5, 2025  
**Project Code Name:** Lapis Obscura  
**Status:** Draft for Review

---

## Executive Summary

**Lapis Obscura** is an anonymous publishing platform built on the Open Index Protocol (OIP) that enables whistleblowers, journalists, researchers, and activists to publish information that cannot be censored, while maintaining complete anonymity and ensuring persistent discoverability.

The system combines **one-click home-network deployment**, **Tor onion routing for writer privacy**, **WordPress for familiar authoring**, **persistent peer-to-peer distribution**, and **decentralized name resolution** to create a resilient publishing platform with no single point of failure and no monthly hosting fees.

**Core Promise:** Publish anonymously. Index persistently. Distribute widely. Discover reliably. Moderate locally. Resolve names without central control.

### Key Differentiators

- **Anonymous Publishing**: Tor onion routing hides publisher identity and location
- **Persistent Index**: Records remain discoverable even when original publishers go offline
- **Simple Registration**: Username + password only (no email verification or personal information)
- **Gateway-Scoped Moderation**: Each node operator decides what to index and serve
- **Decentralized Name Resolution**: ENS for mainstream reach, GNS for private lookups
- **Local AI/RAG**: On-device question answering over your indexed content (Alfred)
- **Location Agnostic**: DID spec adherence means data can live anywhere (any blockchain, any storage)
- **One-Click Deploy**: Raspberry Pi images and Docker Compose for home networks
- **No Monthly Fees**: Self-hosted with peer-to-peer distribution

---

## Vision & Mission

### Vision Statement

"A world where truth cannot be silenced, where publishers cannot be identified against their will, and where information persists beyond the reach of censorship."

### Mission Statement

"Build the simplest, most resilient platform for anonymous publishing that combines the familiar (WordPress authoring) with the revolutionary (DID-based identity, Tor anonymity, and persistent peer distribution)—enabling anyone to publish information that matters without fear."

### The DWeb Server Name

**DWeb Server** emphasizes what it is: a decentralized web server that anyone can run. The name is:
- **Descriptive**: Clearly communicates purpose (server for the decentralized web)
- **Accessible**: No learning curve to understand what it does
- **Historical**: Connects to the DWeb movement started at the 2016 DWeb Summit
- **Inclusive**: Appeals to technical and non-technical users alike

---

## Background & Historical Context

### The DWeb Summit Legacy (2016-Present)

**DWeb Server** represents the culmination of nearly a decade of decentralized web development, starting with the first **DWeb Summit in 2016** organized by the Internet Archive. That historic gathering brought together four key technologies that form the foundation of this project:

**The Four Pillars (2016):**

1. **DLOA (Decentralized Library of Alexandria)**: The first system to combine distributed networks (BitTorrent) with blockchain metadata. Tim Berners-Lee called it "thrilling" at the 2016 summit.

2. **IPFS (InterPlanetary File System)**: Content-addressed storage and peer-to-peer file distribution, enabling permanent links that don't break when servers go down.

3. **WebTorrent**: Browser-compatible peer-to-peer streaming, bringing BitTorrent's efficiency to web applications without plugins.

4. **GUN**: Decentralized database with cryptographic user identity and real-time synchronization across nodes.

**Evolution (2016-2025):**
- **2016-2018**: Individual technologies deployed separately, each solving part of the decentralized web puzzle
- **2018-2022**: DLOA evolved into OIP (Open Index Protocol), adding template-based compression and Arweave permanence
- **2022-2024**: Integration of GUN for private encrypted records, ALFRED AI for natural language search
- **2024-Present**: Production deployments for WeAreChange.org and TimCast.com
- **2025**: **DWeb Server** unifies all four pillars into a single, zero-dependency product

**What Makes This Different:**

Previous efforts required choosing between technologies. DWeb Server is the first product to integrate **all four DWeb Summit technologies** plus modern additions (Tor, WordPress, AI) into a cohesive system with **zero central points of failure**.

### Why This Project Matters Now

**Rising Censorship:**
- 40+ major lawsuits against Internet Archive by media companies
- UK age verification mandates
- Russian takedown demands and DNS blocking
- Great Firewall of China expansions
- EU copyright reexamination (June 2026)

**Attacks on Infrastructure:**
- Internet Archive DDoS attacks (repeated)
- October 2024 intrusion (2 weeks before election)
- Cloudflare's gatekeeper business model (charge to access websites)

**Need for Anonymous Publishing:**
- Whistleblowers exposing government/corporate wrongdoing
- Researchers disrupting entrenched industries
- Journalists in authoritarian regimes
- Activists organizing under surveillance

### Brewster Kahle's Vision

From the DWeb Summit session and subsequent discussions:

> "Censorship resistant WebServer. Easy and fun, no monthly fee, open source, private, reliable. One-click downloadable software package to build your own webserver that protects writer privacy."

**Required Components:**
1. **Tor onion server** for writer privacy
2. **WordPress** for familiar authoring
3. **Decentralized DNS** for name resolution
4. **Automatic backups** to archive.org for reliability

**Key Quote from Freedom of the Press Foundation:** "We need this!"

---

## Core Principles

### 1. **Anonymity Without Compromise**

- Publisher IP addresses never exposed
- Simple registration (username + password only, no email verification)
- Tor onion routing for all publish operations
- DID-based identity without revealing real-world identity

### 2. **Persistent Discoverability**

- Records indexed in an open, queryable database
- Metadata survives even when publishers go offline
- Multiple gateways replicate index for redundancy
- Discovery works when any single node fails

### 3. **Gateway-Scoped Moderation**

- Each operator decides what their gateway indexes
- No global censorship authority
- Abuse controls at ingest and index layers
- Publisher anonymity preserved during review

### 4. **Location Agnostic by Design**

- Records stored anywhere: blockchain, distributed hash tables, local storage
- DID spec adherence means true portability
- Currently uses Arweave; could use Bitcoin, Ethereum, or any other chain
- Change backend without changing application layer

### 5. **No Single Choke Point**

- Multiple gateways can accept submissions
- Peer-to-peer content distribution
- No central registry or single point of failure
- Each node is independently operated

### 6. **Simple and Accessible**

- Familiar WordPress authoring experience
- One-click installation (Raspberry Pi images, Docker Compose)
- No monthly fees or cloud dependencies
- Works on home networks

### 7. **End-to-End Verifiable**

- DID-based signing proves authorship
- Cryptographic proofs without revealing identity
- Key rotation and revocation supported
- Verifiers check provenance from index

---

## User Stories & Personas

### Persona 1: The Whistleblower

**Background:** Government analyst with evidence of wrongdoing  
**Needs:** Publish documents anonymously without being identified  
**Fears:** Network surveillance, metadata analysis, retaliation

**User Story:**
> "As a whistleblower, I want to publish sensitive documents to a platform that cannot reveal my identity or location, so that I can expose wrongdoing without endangering myself or my family."

**Acceptance Criteria:**
- Can submit documents via Tor without revealing IP address
- Can sign documents with a DID key not linked to real identity
- Documents remain accessible even if original gateway is shut down
- Cannot be traced through timing analysis or network forensics

### Persona 2: The Independent Journalist

**Background:** Freelance reporter covering corporate corruption  
**Needs:** Publish articles that cannot be taken down by legal threats  
**Fears:** SLAPP suits, content takedowns, loss of platform

**User Story:**
> "As an independent journalist, I want to publish my investigative reporting to a platform where it cannot be censored or removed, so that my work remains accessible regardless of legal pressure."

**Acceptance Criteria:**
- Can write articles in WordPress with familiar interface
- Can publish to persistent index that no single entity controls
- Articles discoverable through open search interface
- Can build reputation through pseudonymous DID without doxxing

### Persona 3: The Academic Researcher

**Background:** University researcher with findings that threaten pharmaceutical industry  
**Needs:** Publish research data that contradicts corporate-funded studies  
**Fears:** Pressure on university, loss of funding, career damage

**User Story:**
> "As a researcher, I want to publish my findings in a way that ensures they cannot be suppressed, so that the scientific community has access to unbiased data."

**Acceptance Criteria:**
- Can publish datasets with proper provenance
- Can attach cryptographic signatures proving data integrity
- Data remains available even if university demands takedown
- Can publish under pseudonym while maintaining scientific credibility

### Persona 4: The Gateway Operator

**Background:** Privacy advocate running a node from home  
**Needs:** Contribute to censorship-resistant infrastructure without liability  
**Fears:** Legal trouble for hosting objectionable content

**User Story:**
> "As a gateway operator, I want to run a node that helps publishers while retaining control over what I index and serve, so that I can support free speech without taking on unlimited legal risk."

**Acceptance Criteria:**
- Can set moderation policies for my gateway
- Can approve/quarantine/reject submissions based on my criteria
- Can operate node from home network without exposing personal info
- Not liable for content indexed by other gateways

### Persona 5: The Archivist/Reader

**Background:** Historian researching suppressed information  
**Needs:** Discover and access records that might be censored elsewhere  
**Fears:** Content disappearing before it can be studied

**User Story:**
> "As a researcher, I want to search across multiple gateways to find records that might be suppressed on mainstream platforms, so that I can access comprehensive historical information."

**Acceptance Criteria:**
- Can query across multiple gateway indexes
- Can verify provenance and authenticity of records
- Can use local AI (Alfred) to ask questions about discovered content
- Content remains accessible even if original publishers are offline

---

## System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         PUBLISHER LAYER                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌─────────────┐      ┌──────────────┐  │
│  │ WordPress    │──┬──>│  Tor Onion  │──┬──>│   Gateway    │  │
│  │ (Authoring)  │  │   │   Service   │  │   │  (Publish    │  │
│  │              │  │   │             │  │   │   Ingest)    │  │
│  └──────────────┘  │   └─────────────┘  │   └──────────────┘  │
│                    │                     │                      │
│  ┌──────────────┐  │   ┌─────────────┐  │   ┌──────────────┐  │
│  │  Air-Gapped  │──┘   │ Export .lopkg│──┘   │   Status     │  │
│  │   Signing    │      │  (Offline)  │      │    API       │  │
│  └──────────────┘      └─────────────┘      └──────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE LAYER                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌─────────────┐      ┌──────────────┐  │
│  │  Arweave     │      │    GUN      │      │ Alternative  │  │
│  │ (Metadata    │      │ (Private    │      │  Blockchain  │  │
│  │  Storage)    │      │  Records)   │      │  (Optional)  │  │
│  └──────────────┘      └─────────────┘      └──────────────┘  │
│                                                                 │
│  Note: DID spec means metadata can live anywhere              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DISTRIBUTION LAYER                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌─────────────┐      ┌──────────────┐  │
│  │  BitTorrent  │      │    IPFS     │      │     HTTP     │  │
│  │ (WebTorrent) │      │  (Optional) │      │   Fallback   │  │
│  └──────────────┘      └─────────────┘      └──────────────┘  │
│                                                                 │
│  Peer-to-peer distribution reduces reliance on publishers     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DISCOVERY LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌─────────────┐      ┌──────────────┐  │
│  │Elasticsearch │      │   Gateway   │      │   Gateway    │  │
│  │   (Index)    │      │   Node A    │      │   Node B     │  │
│  │              │      │  (Moderated)│      │  (Moderated) │  │
│  └──────────────┘      └─────────────┘      └──────────────┘  │
│                                                                 │
│  Each gateway independently indexes and serves records        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       CONSUMER LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌─────────────┐      ┌──────────────┐  │
│  │   Web UI     │      │   Alfred    │      │   Mobile     │  │
│  │  (Browser)   │      │ (Local AI)  │      │    Apps      │  │
│  │              │      │   RAG Q&A   │      │              │  │
│  └──────────────┘      └─────────────┘      └──────────────┘  │
│                                                                 │
│  Readers discover and verify content across gateways          │
└─────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### 1. **Publisher Layer** (New for Lapis Obscura)

**WordPress Plugin ("LO Publisher")**
- Familiar authoring interface with Gutenberg editor
- Local DID key management (ed25519 signing keys)
- Export signed packages (.lopkg files) for offline relay
- Direct submission to gateway via Tor onion service
- Media manifest generation (no large files over Tor)

**Tor Onion Service**
- v3 hidden service for publisher anonymity
- Accepts publish submissions on loopback-only gateway
- Strips all identifying headers and metadata
- Batches submissions to reduce timing correlation

**Air-Gapped Signing**
- Create signed records offline
- Export to USB drive or courier
- Submit from different network/location
- Complete separation of signing and submission

#### 2. **Persistence Layer** (Blockchain-Agnostic)

**Current Implementation: Arweave**
- Permanent storage of record descriptors
- Immutable metadata cannot be altered
- Transaction IDs provide content addressing

**DID Spec Adherence**
- Records use `did:arweave:txid` format
- Can change to `did:bitcoin:...`, `did:ethereum:...`, etc.
- Persistence mechanism is abstracted from application layer
- Metadata structure remains identical regardless of backend

**Alternative Storage Options**
- Bitcoin blockchain (OP_RETURN or Ordinals)
- Ethereum (IPFS hash + ENS)
- Local DHT (Distributed Hash Table)
- Any system supporting DID resolution

#### 3. **Distribution Layer** (Content Delivery)

**BitTorrent/WebTorrent**
- Peer-to-peer distribution for large files
- Magnet URIs in record metadata
- Browser-compatible via WebTorrent
- Persistent seeding by gateway nodes

**IPFS (Optional)**
- Decentralized content addressing
- CID references in record metadata
- Gateway pinning for availability

**HTTP Fallback**
- Direct serving from gateway nodes
- Range request support for streaming
- Authentication for private records

**Key Principle**: Content is **referenced** in records, not embedded. Large files never go over Tor.

#### 4. **Discovery Layer** (Gateway Nodes)

**Gateway Node Architecture**
- Elasticsearch for full-text search
- GUN for real-time synchronization
- Moderation queue with configurable policies
- Public API for queries and retrieval

**Gateway Moderation**
- Each operator sets own policies
- Size limits, MIME type allowlists
- Tag-based auto-approval/quarantine
- Hash-based deny lists
- Rate limiting per publisher DID

**Cross-Gateway Discovery**
- Records replicated across multiple gateways
- Each gateway has independent moderation
- Content suppressed on one gateway may appear on others
- No global consensus required

#### 5. **Consumer Layer** (Discovery and Retrieval)

**Web UI**
- Browse and search across gateway indexes
- View records with full provenance
- Verify DID signatures
- Download content via peer networks

**Alfred (Local AI/RAG)**
- On-device question answering
- Queries your local gateway's indexed content
- No cloud dependencies
- Voice interface option (Mac client)

**Mobile/Desktop Apps**
- Native applications for iOS/Android/macOS/Windows
- Offline reading with synchronized indexes
- Peer-to-peer content retrieval

---

## Key Features

### Feature 1: Anonymous Publishing via Tor

**Description**: Publishers submit records through Tor onion services, ensuring network-level anonymity.

**User Benefit**: Whistleblowers and activists can publish without revealing their IP address, location, or network path.

**Technical Implementation**:
- Tor v3 onion service with persistent keys
- Gateway bound to loopback only (127.0.0.1)
- All headers stripped (X-Forwarded-For, Via, etc.)
- Batched submission to clearnet backends (timing obfuscation)

**Acceptance Criteria**:
- Gateway accessible via .onion address
- No IP addresses logged from onion submissions
- Tor Browser successfully publishes test records
- Timing analysis reveals no one-to-one correlation

### Feature 2: WordPress-First Authoring

**Description**: Familiar WordPress interface for composing posts, pages, and media-rich content.

**User Benefit**: No learning curve—journalists and writers use tools they already know.

**Technical Implementation**:
- WordPress plugin ("LO Publisher")
- Gutenberg sidebar panel for OIP integration
- Field mapping: WP fields → OIP template fields
- Local key management with encrypted storage

**Acceptance Criteria**:
- Standard WordPress install + plugin works
- Compose post → click "Publish to OIP" → receive receipt
- Export signed package works offline
- Media references generated automatically

### Feature 3: DID-Based Identity (OIP 0.9)

**Description**: Publishers use Decentralized Identifiers (DIDs) instead of accounts, following W3C standards.

**User Benefit**: No registration, no email, no personal information—just cryptographic identity.

**Technical Implementation**:
- BIP-39 mnemonic (12-word recovery phrase)
- BIP-32 HD wallet with SLIP-0043 derivation paths
- Purpose-scoped child keys (signing, delegation, revocation)
- DID Document records published to index

**Derivation Path Structure**:
```
m / 43' / 176800' / <sub-purpose'> / <account'> / <index>

Where:
- 43' = SLIP-0043 custom purpose (not SLIP-0044 coin type)
- 176800' = OIP namespace
- sub-purpose' ∈ {0=sign, 1=encrypt, 2=delegate, 3=revoke, ...}
- account' = account number (0' for default)
- index = per-record key (derived from txId for xpub mode)
```

**Key Security Features**:
- Master key never used for signing
- Read-only xpub allows verification without private key
- Rolling keys: new key burns old keys automatically
- Binding proofs for hardened child keys

**Acceptance Criteria**:
- Generate DID from mnemonic
- Sign records with child keys
- Verify signatures via xpub derivation
- Export/import mnemonic works across nodes

### Feature 4: Gateway-Scoped Moderation

**Description**: Each gateway operator decides what to index and serve—no global censorship authority.

**User Benefit**: Publishers aren't at mercy of single moderator; content suppressed on one gateway may appear on others.

**Technical Implementation**:
- Configurable ingest policies per gateway
- MIME allowlists, size limits, tag rules
- Review queue with approve/quarantine/reject actions
- Hash denylists (CSAM, malware)

**Moderation Controls**:
- **Size caps**: Max record body size (configurable, default 25MB metadata)
- **MIME allowlists**: Image/video/document types allowed
- **Tag policies**: Auto-approve records with certain tags
- **Rate limits**: Per-publisher DID throttling
- **Hash denylists**: Known abusive content blocked

**Acceptance Criteria**:
- Operator sets policy → records filtered accordingly
- Reject reasons returned to publisher with error codes
- Approved records appear in index within SLA
- Different gateways show different result sets

### Feature 5: Persistent Discoverability

**Description**: Records remain discoverable even when original publishers go offline.

**User Benefit**: Information survives publisher shutdown, network failure, or legal pressure.

**Technical Implementation**:
- Metadata stored on persistent blockchain (Arweave)
- Content distributed via peer networks (BitTorrent, IPFS)
- Multiple gateway nodes replicate index
- Elasticsearch provides full-text search

**Discovery Flow**:
```
1. Publisher submits record → stored on Arweave
2. Gateway indexes record → Elasticsearch
3. Other gateways sync record → replicate index
4. Content seeded → BitTorrent/WebTorrent
5. Publisher goes offline
6. Readers still discover via gateways
7. Readers retrieve content via peer network
```

**Acceptance Criteria**:
- Publish record → gateway indexes within 60 seconds
- Other gateways sync within 5 minutes
- Publisher node goes offline → content still discoverable
- Peer network serves content without publisher seeding

### Feature 6: Local AI/RAG (Alfred)

**Description**: On-device AI assistant that answers questions about indexed content without cloud dependencies.

**User Benefit**: Query your gateway's content privately; no data sent to external services.

**Technical Implementation**:
- Local LLM (Ollama: llama3.2:3b or similar)
- RAG pipeline with Elasticsearch vector search
- Voice interface option (Mac client)
- Conversation history stored locally (encrypted)

**Alfred Capabilities**:
- "Who published research on topic X?"
- "What records mention company Y?"
- "Summarize all articles by author Z"
- "Find datasets related to keyword W"

**Acceptance Criteria**:
- Install gateway → Alfred works out of box
- Ask natural language question → receive relevant records
- Voice input/output works on Mac client
- No network calls to external AI services

### Feature 7: Create-But-Don't-Send

**Description**: Export signed records as files for out-of-band relay—complete air gap between signing and submission.

**User Benefit**: Maximum anonymity—sign on one machine, submit from unrelated network.

**Technical Implementation**:
- WordPress plugin exports `.lopkg` (Lapis Obscura Package)
- Package contains: signed record JSON, media manifest, optional attachments
- Separate tool/endpoint accepts `.lopkg` submissions
- Courier or automated relay forwards to gateway

**Use Cases**:
- Journalist signs on air-gapped laptop
- Courier carries USB drive across border
- Third party submits from coffee shop WiFi
- Complete separation of identity and network

**Acceptance Criteria**:
- Export signed package from WordPress
- Package validates offline
- Submit package via separate network
- Gateway accepts package and indexes record

### Feature 8: One-Click Deployment

**Description**: Pre-configured images for Raspberry Pi and Docker Compose for zero-config setup.

**User Benefit**: Non-technical users can run a gateway from their home network.

**Technical Implementation**:
- **Raspberry Pi Image**: Flash SD card → boot → follow wizard
- **Docker Compose**: `docker-compose up` → entire stack running
- **Setup Wizard**: Configure DID keys, moderation policies, peers

**Stack Includes**:
- WordPress with LO Publisher plugin
- Tor onion service (auto-configured)
- Gateway node (OIP backend)
- Elasticsearch (index layer)
- MediaSeeder (BitTorrent/IPFS)
- Alfred (local AI/RAG)

**Acceptance Criteria**:
- Raspberry Pi boots and presents setup wizard
- Docker Compose starts all services
- Publish test record end-to-end within 10 minutes
- Query via Alfred works immediately

### Feature 9: Verifiable Provenance

**Description**: Cryptographic proofs allow readers to verify who published what, and when.

**User Benefit**: Trust information without trusting intermediaries—verify signatures directly.

**Technical Implementation**:
- Each record signed with publisher's DID child key
- Signature algorithm: Ed25519 or Secp256k1
- DID Document published to index (verification method)
- Readers derive public key from xpub or verify binding proof

**Verification Process**:
```
1. Fetch record from gateway
2. Extract signature and DID reference
3. Resolve DID Document from index
4. Derive public key (xpub mode) or verify binding (hardened mode)
5. Verify signature over canonical record JSON
6. Check key hasn't been revoked
```

**Acceptance Criteria**:
- Publish signed record
- Reader verifies signature independently
- Invalid signature detected and flagged
- Revoked keys marked as invalid

### Feature 10: No Monthly Fees

**Description**: Self-hosted on home network with no ongoing costs.

**User Benefit**: Freedom of speech shouldn't require subscription fees or cloud hosting.

**Technical Implementation**:
- All software open source
- Runs on consumer hardware (Raspberry Pi, NUC, old laptop)
- Peer-to-peer distribution spreads bandwidth costs
- Optional donations to gateway operators (future)

**Cost Breakdown**:
- **Hardware**: $35 (Raspberry Pi 4) - $200 (NUC) one-time
- **Network**: Existing home internet (no additional cost)
- **Blockchain Fees**: Optional (someone else can sponsor)
- **Ongoing**: $0/month

**Acceptance Criteria**:
- Deploy stack on Raspberry Pi without paid services
- Publish records without blockchain fee requirement (sponsored)
- Retrieve content via peer networks (no bandwidth bills)
- System runs indefinitely without subscription

---

## Technical Specifications

### Identity & Authentication (OIP 0.9)

#### DID Method Specification

**DID Format**: `did:key:z6Mk...` (master identity)  
**DID Documents**: Stored as OIP records, referenced by `did:arweave:txid`

**Components**:
```json
{
  "didDocument": {
    "did": "did:key:z6Mk...",
    "controller": "did:key:z6Mk...",
    "verificationMethod": [
      "did:arweave:vm_xpub_tx",
      "did:arweave:vm_hardened_tx"
    ],
    "authentication": ["#sign"],
    "assertionMethod": ["#sign", "#sign-hardened"],
    "oip_handle": "whistleblower_7",
    "oip_name": "Anonymous",
    "anchor_arweave_txid": "tx_of_this_document"
  }
}
```

#### Verification Method Types

**Type 1: xpub-based (non-hardened leaf)**
```json
{
  "vm_type": "oip:XpubDerivation2025",
  "xpub": "xpub6CUGRUonZSQ...",
  "derivation_sub_purpose": "identity.sign",
  "derivation_account": 0,
  "leaf_indexPolicy": "txid_hash",
  "leaf_hardened": false
}
```

**Type 2: Binding proof (hardened leaf)**
```json
{
  "vm_type": "Ed25519VerificationKey2020",
  "publicKeyMultibase": "z6MkfY...child",
  "derivation_sub_purpose": "identity.sign",
  "leaf_hardened": true,
  "bindingProof_jws": "eyJhbGciOiJFZERTQSJ9..."
}
```

#### Signature Algorithm

**Signing Process**:
1. Assemble `DataForSignature` object (all record fields except signature)
2. Canonicalize to deterministic JSON (sorted keys, LF line endings)
3. Hash with SHA256
4. Sign hash with child private key (Ed25519 or Secp256k1)
5. Base64url encode signature
6. Attach as `CreatorSig` tag or field

**Verification Process**:
1. Parse DID from record
2. Resolve DID Document
3. Select appropriate verification method
4. Derive public key (xpub mode) or verify binding proof (hardened mode)
5. Recompute canonical hash
6. Verify signature with derived public key

### Publisher Gateway API

#### Endpoint: POST /publish

**Description**: Accept signed record submission via Tor

**Request**:
```http
POST /publish HTTP/1.1
Host: <gateway_onion_address>.onion
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <uuid>

{
  "record": {
    "basic": {
      "name": "Article Title",
      "description": "Summary",
      "date": 1736985600,
      "tagItems": ["whistleblower", "corruption"]
    },
    "post": {
      "articleText": "Full article content...",
      "bylineWriter": "Anonymous Journalist"
    }
  },
  "signature": {
    "did": "did:key:z6Mk...",
    "verificationMethod": "#sign",
    "jws": "eyJhbGciOiJFZERTQSJ9..."
  },
  "meta": {
    "wordpress": {
      "post_id": 42,
      "post_type": "post"
    }
  }
}
```

**Response**:
```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "submissionId": "sub_abc123",
  "status": "queued",
  "estimatedStart": "2025-01-15T12:34:56Z"
}
```

**Error Codes**:
- `400` - Invalid record schema
- `401` - Invalid signature or token
- `413` - Record exceeds size limit
- `415` - Unsupported MIME type in media
- `429` - Rate limit exceeded
- `503` - Gateway temporarily unavailable

#### Endpoint: GET /status/:submissionId

**Description**: Check submission processing status

**Response**:
```json
{
  "submissionId": "sub_abc123",
  "status": "succeeded",
  "outputs": {
    "did": "did:arweave:new_tx_id",
    "arweave_txid": "new_tx_id",
    "indexed_at": "2025-01-15T12:35:30Z"
  }
}
```

**Status Values**:
- `queued` - Awaiting processing
- `processing` - Being validated and stored
- `succeeded` - Published and indexed
- `failed` - Rejected (see `error` field)

#### Endpoint: GET /queue/limits

**Description**: Get gateway moderation policies

**Response**:
```json
{
  "maxBodyMb": 25,
  "maxAttachments": 10,
  "mimeAllow": ["image/jpeg", "image/png", "video/mp4", "application/pdf"],
  "tagPolicy": {
    "autoApprove": ["research", "journalism"],
    "requireReview": ["sensitive"],
    "reject": ["spam"]
  },
  "rps": 5,
  "moderationMode": "approve-by-default"
}
```

### Media Distribution

#### Media Manifest Structure

**Included in Record Metadata**:
```json
{
  "media": [
    {
      "filename": "document.pdf",
      "size": 2458624,
      "sha256": "abc123...",
      "mimeType": "application/pdf",
      "distribution": {
        "bittorrent": {
          "magnetURI": "magnet:?xt=urn:btih:...",
          "infoHash": "def456...",
          "trackers": ["wss://tracker.openwebtorrent.com"]
        },
        "ipfs": {
          "cid": "QmXyz789..."
        },
        "http": [
          "https://gateway-a.example/media/abc123",
          "https://gateway-b.example/media/abc123"
        ]
      }
    }
  ]
}
```

#### Media Upload Flow

1. **WordPress**: Author attaches file to post
2. **Plugin**: Generates SHA256 hash (mediaId)
3. **Seeder**: Creates BitTorrent torrent, seeds via WebTorrent
4. **Plugin**: Generates manifest with magnet URI
5. **Gateway**: Optionally pins to IPFS, adds HTTP mirror
6. **Record**: Published with media manifest (not file contents)
7. **Readers**: Retrieve via BitTorrent/IPFS/HTTP (peer network)

**Key Principle**: Large files never go over Tor—only small metadata manifests.

### Gateway Moderation Policies

#### Abuse-Aware Controls

**Size Caps**:
- Default: 25MB for record metadata (not media files)
- Configurable per gateway
- Prevents storage exhaustion attacks

**MIME Type Allowlists**:
- Gateway defines permitted content types
- Example: Allow documents, images, videos; block executables
- Prevents malware distribution

**Hash Denylists**:
- Known CSAM/malware hashes blocked
- Industry-standard lists (NCMEC, VirusTotal)
- Content never stored or served

**Rate Limits**:
- Per-publisher DID throttling
- Example: 10 submissions/hour/DID
- Prevents spam and DoS

**Topic-Scoped Queues**:
- Tag-based auto-approval
- Example: "research" → auto-approve; "sensitive" → review queue
- Allows trusted publishers to bypass review

#### Moderation Actions

**Approve**: Index and serve record publicly  
**Quarantine**: Index but mark for review; show in admin panel only  
**Hide**: Index but don't serve; preserve for legal/transparency  
**Reject**: Don't index; return error code to publisher

**Key Principle**: Decisions are per-gateway. Content rejected by one gateway may be approved by another.

### Search and Discovery

#### Elasticsearch Index Structure

**Record Document**:
```json
{
  "oip": {
    "did": "did:arweave:tx_id",
    "recordType": "post",
    "storage": "arweave",
    "indexedAt": "2025-01-15T12:35:30Z",
    "creator": {
      "did": "did:key:z6Mk...",
      "handle": "whistleblower_7",
      "publicKey": "..."
    }
  },
  "data": {
    "basic": {
      "name": "Article Title",
      "description": "Summary",
      "date": 1736985600,
      "tagItems": ["whistleblower", "corruption"]
    },
    "post": {
      "articleText": "Full article content...",
      "bylineWriter": "Anonymous Journalist"
    }
  },
  "signature_verified": true,
  "gateway_moderation": {
    "status": "approved",
    "reviewed_by": "gateway_node_id",
    "reviewed_at": "2025-01-15T12:36:00Z"
  }
}
```

#### Query Capabilities

**Full-Text Search**:
- Search across all text fields
- Weighted by relevance (title > description > content)
- Tag-based filtering

**Field-Specific Queries**:
- By author DID
- By date range
- By record type
- By media type (image, video, document)

**Alfred RAG Integration**:
- Natural language queries
- Context-aware responses
- Citation with DIDs
- Local processing (no cloud)

### Alfred (Local AI/RAG)

#### Architecture

**Components**:
- **Ollama**: Local LLM server (llama3.2:3b default)
- **Elasticsearch**: Vector search + full-text
- **RAG Pipeline**: Question analysis → search → context building → generation
- **Voice Interface**: Speech-to-text (Whisper) + text-to-speech (Kokoro/ElevenLabs)

#### Capabilities

**Question Understanding**:
- "What records mention XYZ company?" → Search + summarize
- "Who published research on topic ABC?" → Author identification
- "Find documents signed by DID xyz123" → Provenance search

**Context Building**:
- Fetch relevant records from Elasticsearch
- Extract full text from referenced content
- Build context window for LLM
- Cite sources with DIDs

**Response Generation**:
- Local LLM processes query + context
- Generates answer with citations
- Returns sources for verification
- No data sent to external services

**Privacy**:
- All processing on-device
- No cloud API calls
- Conversation history encrypted locally
- Voice data never leaves machine

---

## Implementation Phases

### Phase 1: Foundation (Months 1-3)

**Deliverables**:
- [ ] OIP 0.9 DID system fully implemented
- [ ] Gateway API with Tor onion service
- [ ] WordPress plugin (basic version)
- [ ] Docker Compose deployment
- [ ] Documentation for developers

**Success Criteria**:
- Publish record via Tor → indexed on gateway
- Sign with DID child key → verify via xpub
- WordPress plugin exports signed packages
- Docker Compose starts all services

**Key Technical Work**:
- DID Document template and resolution
- HD wallet key derivation (SLIP-0043)
- Signature verification (xpub and binding proofs)
- WordPress plugin development
- Tor onion service setup

### Phase 2: Anonymity & Moderation (Months 4-6)

**Deliverables**:
- [ ] Tor onion service hardened (timing obfuscation)
- [ ] Gateway moderation policies implemented
- [ ] Create-but-don't-send (.lopkg export/import)
- [ ] Cross-gateway synchronization
- [ ] Abuse-aware controls (size caps, MIME filters, rate limits)

**Success Criteria**:
- Timing analysis reveals no correlation
- Moderation queue with approve/quarantine/reject
- Export package → submit from different network
- Multiple gateways replicate records
- Spam/malware submissions blocked

**Key Technical Work**:
- Batched submission with randomized delays
- Moderation queue UI and API
- Package format (.lopkg) specification
- GUN sync service enhancements
- Hash denylist integration

### Phase 3: Distribution & Discovery (Months 7-9)

**Deliverables**:
- [ ] BitTorrent/WebTorrent media distribution
- [ ] IPFS integration (optional)
- [ ] Alfred RAG system integrated
- [ ] Advanced search with filters
- [ ] Cross-gateway discovery UI

**Success Criteria**:
- Publish with media → peers seed via BitTorrent
- Query via Alfred → receive relevant records
- Search across multiple gateways
- Content available when publisher offline

**Key Technical Work**:
- MediaSeeder service optimization
- IPFS pinning service
- Alfred integration with gateway index
- Multi-gateway query aggregation
- Content availability monitoring

### Phase 4: One-Click Deployment (Months 10-12)

**Deliverables**:
- [ ] Raspberry Pi image (complete stack)
- [ ] Setup wizard (GUI for configuration)
- [ ] Automatic updates
- [ ] Kiosk mode (VNC-style "reporting desk")
- [ ] Production-ready documentation

**Success Criteria**:
- Non-technical user deploys from Pi image
- Setup wizard completes in <10 minutes
- System runs for 30 days without intervention
- Kiosk mode works for multi-user deployments

**Key Technical Work**:
- Raspberry Pi OS customization
- First-run setup wizard
- Automatic update mechanism
- Kiosk mode isolation and security
- End-user documentation

### Phase 5: Ecosystem & Adoption (Months 13-15)

**Deliverables**:
- [ ] Mobile apps (iOS/Android)
- [ ] Desktop apps (macOS/Windows/Linux)
- [ ] Name resolution bridge (Handshake/GNS/ENS)
- [ ] Archive.org backup integration
- [ ] Gateway operator community

**Success Criteria**:
- 100+ gateways operational
- 1000+ publishers using system
- 10,000+ records indexed
- Mobile apps in app stores
- Name resolution for major gateways

**Key Technical Work**:
- Native app development
- DNS bridge implementation
- Archive.org API integration
- Gateway discovery service
- Community building and outreach

---

## Success Metrics

### Publisher Metrics

**Anonymity**:
- 0% of submissions contain publisher IP addresses
- 0% timing correlation between Tor submission and clearnet publish
- 100% of .onion submissions succeed without identity leakage

**Usability**:
- <10 minutes to complete setup (from image to first publish)
- <2 seconds from "Publish" click to submission receipt
- >90% of submissions succeed on first attempt
- <5% rejections due to policy violations (after initial learning)

**Adoption**:
- 100+ active publishers in first 6 months
- 1000+ active publishers by end of year 1
- 50% of publishers use WordPress plugin
- 30% of publishers use create-but-don't-send

### Gateway Metrics

**Reliability**:
- >99.5% uptime for gateway API
- <60 seconds to index approved submissions
- <5 minutes for cross-gateway synchronization
- >95% of media available via peer networks

**Moderation**:
- <1% false positive rejections (valid content blocked)
- <0.1% false negatives (abusive content approved)
- <24 hours for manual review queue items
- >80% of submissions auto-approved (after policy tuning)

**Discoverability**:
- >3 gateways index each record (redundancy)
- <5 seconds for full-text search queries
- >90% of searches return relevant results
- 100% of records verifiable via DID signatures

### Reader Metrics

**Discovery**:
- >50% of queries satisfied by first page of results
- <3 seconds for search result rendering
- >80% of records have available content (via peer networks)
- <10 seconds to verify record signature

**Alfred RAG**:
- >80% of questions answered correctly
- <10 seconds for RAG query response
- 100% of processing happens locally (no cloud calls)
- >70% user satisfaction with voice interface

### Ecosystem Metrics

**Resilience**:
- Records remain discoverable when 50% of gateways offline
- Content retrievable when original publisher offline
- Zero single points of failure in architecture
- <1 hour to deploy new gateway node

**Cost**:
- $0/month ongoing costs for home deployments
- <$100 one-time hardware cost (Raspberry Pi setup)
- <$500 one-time cost for higher-end gateway (NUC/server)
- Optional blockchain fees sponsored by others

**Adoption**:
- 10 production gateways by month 6
- 100 production gateways by end of year 1
- 5 organizations (journalism/activism) using as primary platform
- 50% of gateways operated from home networks

---

## Risks & Mitigations

### Risk 1: Timing Correlation Attacks

**Description**: Adversary observes Tor submission timing and correlates with blockchain publish time to identify publisher.

**Impact**: HIGH - Deanonymizes publishers despite Tor

**Likelihood**: MEDIUM - Requires global network view

**Mitigation**:
- Batch submissions with randomized delays (60s ± 30s jitter)
- Mix records from multiple publishers in each batch
- Vary delay windows based on network load
- Document timing attack surface for operators

**Residual Risk**: LOW - Requires sustained observation of both Tor and blockchain

### Risk 2: Gateway Operator Liability

**Description**: Operator faces legal action for content indexed by their gateway.

**Impact**: MEDIUM - Operators shut down nodes due to legal pressure

**Likelihood**: MEDIUM - Depends on jurisdiction and content

**Mitigation**:
- Gateway-scoped moderation gives operators control
- Abuse-aware controls (MIME filters, hash denylists)
- Clear documentation of legal safe harbors (DMCA, Section 230)
- Community legal defense fund (future)
- Operators can run gateway anonymously via Tor

**Residual Risk**: MEDIUM - Legal landscape varies by jurisdiction

### Risk 3: Storage Exhaustion Attacks

**Description**: Attacker floods gateway with large records to exhaust storage.

**Impact**: MEDIUM - Gateway becomes unavailable

**Likelihood**: MEDIUM - Easy to execute without mitigation

**Mitigation**:
- Size caps on record metadata (25MB default)
- Rate limits per publisher DID (10 submissions/hour)
- Storage quotas per gateway (configurable)
- Media files distributed via peer networks (not stored on gateway)

**Residual Risk**: LOW - Controls make attack economically infeasible

### Risk 4: Sybil Attacks (Spam Publishers)

**Description**: Attacker creates many DID identities to evade rate limits.

**Impact**: MEDIUM - Gateway spam reduces signal-to-noise

**Likelihood**: HIGH - DIDs are free to generate

**Mitigation**:
- Proof-of-work per submission (optional, future)
- Reputation systems for DID identities (future)
- Tag-based auto-approval (trusted publishers bypass review)
- Community curation of high-quality gateways

**Residual Risk**: MEDIUM - Arms race between spammers and defenders

### Risk 5: Content Moderation Challenges

**Description**: Balance between censorship resistance and preventing abusive content.

**Impact**: HIGH - Platform reputation and operator liability

**Likelihood**: HIGH - Will encounter abusive content

**Mitigation**:
- Gateway-scoped moderation (no global decisions)
- Industry-standard hash denylists (CSAM, malware)
- Transparent moderation policies per gateway
- Multiple gateways with different policies
- Legal safe harbor protections for operators

**Residual Risk**: MEDIUM - Ongoing challenge requiring community norms

### Risk 6: Key Loss or Compromise

**Description**: Publisher loses mnemonic or private key is stolen.

**Impact**: HIGH for affected publisher - Loses identity and cannot publish

**Likelihood**: MEDIUM - User error or device compromise

**Mitigation**:
- 12-word mnemonic backup during setup
- Encrypted mnemonic storage with password
- Key rotation supported (rolling keys)
- Revocation mechanism via DID Documents
- Hardware key support (future)

**Residual Risk**: MEDIUM - User responsibility for key management

### Risk 7: Blockchain Backend Failure

**Description**: Arweave network becomes unavailable or prohibitively expensive.

**Impact**: HIGH - Cannot persist new records

**Likelihood**: LOW - Arweave has strong track record

**Mitigation**:
- DID spec means metadata can move to different chain
- Already abstracted at application layer
- Can switch to Bitcoin, Ethereum, or other backend
- Local DHT mode for temporary outages (future)

**Residual Risk**: LOW - System is blockchain-agnostic

### Risk 8: Tor Network Attacks

**Description**: Tor network compromised or blocked by nation-states.

**Impact**: HIGH - Publishers cannot submit anonymously

**Likelihood**: MEDIUM - Ongoing threat from state actors

**Mitigation**:
- Create-but-don't-send allows offline relay
- I2P integration as Tor alternative (future)
- VPN + Tor for defense in depth
- Pluggable transports to evade blocking

**Residual Risk**: MEDIUM - Nation-state adversaries are persistent

### Risk 9: Low Adoption / Network Effects

**Description**: Insufficient publishers and gateways to achieve critical mass.

**Impact**: HIGH - Platform fails to gain traction

**Likelihood**: MEDIUM - Many decentralized platforms struggle with adoption

**Mitigation**:
- Partnership with journalism organizations (FPF, EFF)
- Integration with existing WordPress sites (large user base)
- One-click deployment lowers barrier to entry
- Alfred RAG provides unique value (local AI)
- Historical OIP credibility (DLOA, Tim Berners-Lee endorsement)

**Residual Risk**: MEDIUM - Market risk inherent to new platforms

### Risk 10: Regulatory Capture

**Description**: Governments mandate backdoors, logging, or identification requirements.

**Impact**: HIGH - Defeats core anonymity promise

**Likelihood**: LOW to MEDIUM - Depends on jurisdiction

**Mitigation**:
- Open source → forks cannot be prevented
- Distributed development (no single legal entity)
- Operators can run nodes in friendly jurisdictions
- Technical design makes backdoors infeasible (no central control)

**Residual Risk**: MEDIUM - Varies by operator location

---

## Appendix A: Comparison to Alternatives

### Lapis Obscura vs. Traditional Blogging Platforms

| Feature | Lapis Obscura | Medium/Substack | WordPress.com |
|---------|---------------|-----------------|---------------|
| **Anonymity** | Tor + DID (no accounts) | Email required | Email required |
| **Censorship Resistance** | Distributed index | Central platform | Central platform |
| **Cost** | $0/month | $0-$50/month | $0-$25/month |
| **Discovery** | Cross-gateway search | Platform discovery | Platform SEO |
| **Control** | Full self-hosting | Platform TOS | Platform TOS |
| **Takedowns** | Gateway-scoped only | Platform-wide | Platform-wide |

### Lapis Obscura vs. Decentralized Social Media

| Feature | Lapis Obscura | Mastodon | Bluesky |
|---------|---------------|----------|---------|
| **Anonymity** | Tor + DID | Email required | Email required |
| **Persistence** | Blockchain + peers | Server-dependent | Platform-dependent |
| **Moderation** | Gateway-scoped | Server-scoped | Platform-scoped |
| **Setup** | One-click Pi image | Server setup required | Account registration |
| **Long-Form** | Full articles | Short posts | Short posts |
| **Media** | P2P distribution | Server storage | Platform storage |

### Lapis Obscura vs. Existing DWeb Projects

| Feature | Lapis Obscura | ZeroNet | IPFS + ENS |
|---------|---------------|---------|------------|
| **Ease of Use** | One-click deploy | Complex setup | Very complex |
| **Authoring** | WordPress | HTML editing | Manual |
| **Anonymity** | Tor built-in | Tor optional | No Tor |
| **Discovery** | Indexed gateways | DHT only | Hard to find content |
| **Moderation** | Gateway-scoped | None | None |
| **Active Development** | ✅ | Inactive | Active |

### Lapis Obscura vs. SecureDrop

| Feature | Lapis Obscura | SecureDrop |
|---------|---------------|------------|
| **Use Case** | Anonymous publishing | Whistleblower submissions |
| **Audience** | Public readership | Specific journalists |
| **Persistence** | Permanent index | Temporary submission |
| **Discovery** | Full-text search | Not applicable |
| **Setup** | One-click Pi image | Requires IT staff |
| **Cost** | $35 (Pi) | $500+ (servers) |

**Key Differentiator**: Lapis Obscura combines the **ease of WordPress** with the **anonymity of Tor**, the **permanence of blockchain**, and the **resilience of peer networks**—a unique combination not found in existing platforms.

---

## Appendix B: User Onboarding Flow

### First-Time Publisher Setup

**Step 1: Install (5 minutes)**
- Option A: Download Raspberry Pi image, flash SD card
- Option B: `git clone` + `docker-compose up`
- Option C: Download desktop app (Mac/Windows/Linux)

**Step 2: Setup Wizard (3 minutes)**
- Choose deployment mode: Publisher + Gateway, or Publisher-only
- Generate DID identity (12-word mnemonic displayed)
- **CRITICAL**: User writes down mnemonic backup
- Set gateway moderation policies (if running gateway)

**Step 3: Configure WordPress (2 minutes)**
- Install LO Publisher plugin (one-click from dashboard)
- Import DID key from setup wizard
- Configure target gateway(s): `.onion` address + token
- Select submission mode: Direct or Export-only

**Step 4: Publish First Record (5 minutes)**
- Write test post in WordPress
- Click "Publish to OIP" button
- Review submission preview (shows what will be signed)
- Confirm → record signed and submitted
- Receive submission receipt with ID

**Step 5: Verify Publication (2 minutes)**
- Check status via plugin dashboard
- Wait for gateway to index (~60 seconds)
- Search for record on gateway web UI
- Verify signature shows your DID
- Content now discoverable by others

**Total Time**: 17 minutes from zero to first publication

### Subsequent Publications

- Write in WordPress as normal
- Click "Publish to OIP"
- Receive instant confirmation
- Content indexed within 60 seconds

**Time per Post**: <30 seconds (after first setup)

---

## Appendix C: Gateway Operator Guide

### Running a Gateway Node

**Hardware Requirements (Minimum)**:
- Raspberry Pi 4 (4GB RAM)
- 128GB SD card or SSD
- Stable internet connection (10 Mbps+)

**Hardware Requirements (Recommended)**:
- Intel NUC or similar (8GB+ RAM)
- 500GB SSD
- 50 Mbps+ internet
- UPS for power reliability

**Software Requirements**:
- Linux (Ubuntu 22.04 or Raspberry Pi OS)
- Docker + Docker Compose
- Tor daemon (v3 onion service)

**Services Included**:
- Gateway API (onion + clearnet)
- Elasticsearch (index layer)
- GUN relay (synchronization)
- MediaSeeder (BitTorrent/IPFS)
- Alfred (local AI/RAG)

**Installation**:
```bash
# Clone repository
git clone https://github.com/oip/lapis-obscura.git
cd lapis-obscura

# Configure environment
cp example.env .env
nano .env  # Set COMPOSE_PROJECT_NAME, moderation policies

# Start stack
docker-compose up -d

# Access setup wizard
open http://localhost:3005/setup
```

**Moderation Policy Configuration**:
```yaml
# .env file
GATEWAY_MAX_BODY_MB=25
GATEWAY_MIME_ALLOWLIST=image/jpeg,image/png,video/mp4,application/pdf
GATEWAY_AUTO_APPROVE_TAGS=research,journalism
GATEWAY_REVIEW_QUEUE_TAGS=sensitive
GATEWAY_RATE_LIMIT_RPS=5
GATEWAY_HASH_DENYLIST_URL=https://example.com/denylist.txt
```

**Operating Costs**:
- Electricity: ~$2-5/month (Raspberry Pi)
- Internet: $0 additional (uses existing connection)
- Hardware: $35-200 one-time
- **Total**: ~$3/month average

**Legal Considerations**:
- Run gateway anonymously via Tor (optional)
- Use VPS in privacy-friendly jurisdiction (optional)
- Implement strong moderation policies
- Document policies publicly
- Consider Section 230 / DMCA safe harbor (US)
- Consult local counsel for jurisdiction-specific advice

---

## Appendix D: Frequently Asked Questions

### For Publishers

**Q: Can my identity be revealed?**  
A: Not through network analysis. Tor hides your IP, DID keys are pseudonymous, no accounts or registration. However, content itself may reveal identity (writing style, metadata), so operational security is your responsibility.

**Q: What if I lose my 12-word mnemonic?**  
A: You lose access to your DID identity permanently. Always back up your mnemonic securely (write it down, store in safe place). Cannot be recovered.

**Q: Can my content be taken down?**  
A: Individual gateways can choose not to index your content, but it remains on the blockchain and other gateways may still serve it. No single entity can remove it globally.

**Q: How much does it cost to publish?**  
A: $0 for you. Blockchain fees (if any) can be sponsored by gateway operators or others. No monthly hosting fees.

**Q: Can I edit or delete published content?**  
A: Records are immutable once published. You can publish updated versions and mark old versions as "superseded" via your DID. Deletions are not possible (by design).

### For Gateway Operators

**Q: Am I liable for content on my gateway?**  
A: Varies by jurisdiction. You have moderation controls and can refuse to index/serve content. Consult legal counsel. Many jurisdictions have safe harbor protections for platforms.

**Q: Can I run a gateway from home?**  
A: Yes! Designed for home network deployment. Use dynamic DNS or Tor onion address. Bandwidth requirements are modest (<10 Mbps for small gateway).

**Q: How much storage is needed?**  
A: Elasticsearch index grows slowly (~1GB per 10,000 records). Media files can be stored on gateway or only seeded via BitTorrent (operator choice).

**Q: Can I shut down my gateway?**  
A: Yes. Content persists on blockchain and other gateways. Shutting down your gateway only affects its index, not the broader network.

### For Readers

**Q: How do I find content?**  
A: Search any gateway's web interface, or use Alfred (local AI) to query your preferred gateway. Content discoverable across all gateways.

**Q: How do I verify content authenticity?**  
A: Each record has a DID signature. Gateway web UI shows verification status. You can independently verify by deriving public key from DID Document.

**Q: What if a gateway is down?**  
A: Try a different gateway. Records replicated across multiple gateways. Content seeded via peer networks remains available.

**Q: Can I download content for offline reading?**  
A: Yes. Use BitTorrent magnet URIs to download files. Records can be exported as JSON for archival.

### Technical

**Q: Why not use IPFS for everything?**  
A: IPFS is great for content, but metadata discoverability is hard. Blockchain + Elasticsearch provides queryable index. We use IPFS for optional content distribution.

**Q: Why Arweave and not Bitcoin?**  
A: Arweave designed for permanent data storage with one-time fee. Bitcoin OP_RETURN is limited to 80 bytes. But DID spec means we can switch to Bitcoin if needed.

**Q: What happens if Arweave disappears?**  
A: DID spec abstraction means we can migrate to different blockchain. Application layer unchanged. Gateway operators can switch persistence backend.

**Q: Why WordPress and not Ghost/Hugo/other?**  
A: WordPress is most widely known and used. We may add Ghost/Hugo plugins later. WordPress gives us largest potential user base.

---

## Appendix E: Roadmap to 1.0 Release

### Version 0.1 (Alpha) - Month 3

**Features**:
- [ ] DID-based identity system
- [ ] Gateway API with Tor onion service
- [ ] WordPress plugin (basic)
- [ ] Docker Compose deployment
- [ ] Signature verification

**Users**: Internal testing only

### Version 0.5 (Beta) - Month 6

**Features**:
- [ ] Create-but-don't-send (.lopkg)
- [ ] Gateway moderation policies
- [ ] Cross-gateway synchronization
- [ ] Abuse-aware controls
- [ ] BitTorrent media distribution

**Users**: Friendly journalists and activists (10-20)

### Version 0.8 (Release Candidate) - Month 9

**Features**:
- [ ] Alfred RAG integration
- [ ] Raspberry Pi image
- [ ] Setup wizard
- [ ] Advanced search
- [ ] IPFS integration

**Users**: Open beta (100+)

### Version 1.0 (Production) - Month 12

**Features**:
- [ ] All above features stable
- [ ] Automatic updates
- [ ] Kiosk mode
- [ ] Production documentation
- [ ] Security audit complete

**Users**: Public release

### Post-1.0 Enhancements

**Version 1.5 (6 months post-1.0)**:
- [ ] Mobile apps (iOS/Android)
- [ ] Desktop apps (native)
- [ ] Name resolution (Handshake/GNS/ENS)
- [ ] Archive.org backup integration

**Version 2.0 (12 months post-1.0)**:
- [ ] Hardware key support (YubiKey, Ledger)
- [ ] Multi-signature publishing
- [ ] Delegation credentials
- [ ] Advanced reputation systems
- [ ] Tipping/subscriptions (optional)

---

## Conclusion

**Lapis Obscura** represents the culmination of over a decade of work on the Open Index Protocol, evolved to meet the urgent need for truly anonymous, censorship-resistant publishing in an increasingly hostile information environment.

### Why This Matters

- **For Whistleblowers**: Expose wrongdoing without fear of identification
- **For Journalists**: Publish stories that cannot be suppressed
- **For Researchers**: Share findings that challenge powerful interests
- **For Activists**: Organize and publish without surveillance

### Why OIP is the Right Foundation

1. **Proven Technology**: 11 years of development (DLOA → OIP)
2. **Standards-Based**: DID spec, W3C compliance, blockchain agnostic
3. **Real-World Use**: Caltech, Wyoming, Imogen Heap, WeAreChange
4. **Historical Credibility**: Tim Berners-Lee called it "thrilling"

### What Makes This Different

- **No Accounts**: Truly anonymous with DID-based identity
- **One-Click Deploy**: Raspberry Pi images, not complex server setups
- **No Monthly Fees**: Self-hosted, peer-to-peer, no cloud dependencies
- **Gateway-Scoped Moderation**: Operators have control without global censorship
- **Local AI**: Alfred provides on-device Q&A with no cloud calls
- **Location Agnostic**: Metadata can live anywhere (not locked to single blockchain)

### The Path Forward

With support from the Internet Archive, Freedom of the Press Foundation, and the broader DWeb community, we can build a platform that:

- Enables truly anonymous publishing
- Resists censorship without creating a lawless wasteland
- Remains accessible to non-technical users
- Costs nothing to operate from home
- Preserves information beyond any single entity's control

**Lapis Obscura**: *Publish in darkness. Persist in stone. Discover in light.*

---

**Document Status**: Draft for Review  
**Next Steps**: 
1. Stakeholder review (Internet Archive, FPF, OIP community)
2. Technical feasibility validation
3. Resource estimation and funding planning
4. Development kickoff (target: Q1 2025)

**Contact**: devon@oip.onl  
**Repository**: https://github.com/oip/lapis-obscura (future)  
**Discussion**: Signal group (see brewsters-project.txt)

