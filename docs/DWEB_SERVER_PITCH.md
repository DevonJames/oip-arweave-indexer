# DWeb Server: Anonymous Publishing for the Decentralized Web

**The Problem:** Internet Archive under attack (40+ lawsuits, Oct 2024 hack), rising censorship, no safe way for whistleblowers to publish anonymously.

**The Solution:** Five 2016 DWeb Summit technologies (OIP, IPFS, WebTorrent, GUN, DIDs) + Tor + WordPress + AI + decentralized DNS. Zero central points of failure.

---

## Key Features

**Anonymity:** Tor + no registration (self-hosted) or username-only (gateway) • Air-gapped signing  
**Deploy:** Pi image or Docker • 10 min • $35-200 hardware, $0/month  
**Author:** WordPress + local signing + export packages  
**Moderation:** Gateway-scoped, no global censorship  
**AI:** Local Alfred (no cloud) + voice interface  
**Names:** ENS (fast) or GNS (private) • No ICANN  
**Persistent:** Survives gateway/publisher failures • Multi-gateway + P2P + blockchain

**Flow:** Author → Sign (DID) → Submit (Tor) → Index → P2P → Blockchain → Discover → Verify

**Deploy Options:** (1) Self-hosted Pi ($35-200, zero registration) or (2) Gateway registration (username only, $0, multi-device). Identity portable between models.

---

## Status & Timeline

**Built (OIP 0.8):** Docker, BitTorrent/IPFS, Alfred AI, Elasticsearch, GUN, moderation, HD wallets.

**18 Weeks to 1.0:** DID system (3w) → WordPress+Tor (5w) → ENS/GNS (5w) → Pi image+Archive.org (5w)

**Track Record:** 2016 DWeb Summit, Tim Berners-Lee endorsement • Caltech, Wyoming, Imogen Heap pilots • DIDs = W3C standard (2022) • Brewster Kahle vision: *"Censorship resistant WebServer. Easy and fun, no monthly fee."*

**Tech:** DIDs = Dewey Decimal for dweb (universal identifiers across all gateways) • Index storage blockchain-agnostic (Arweave, Bitcoin, Ethereum, any chain) • W3C standards, not blockchain hype


## Comparison: What Exists vs. What We're Building

| Feature | DWeb Server | Medium/Substack | SecureDrop | ZeroNet |
|---------|-------------|-----------------|------------|---------|
| **Anonymity** | Tor built-in | Email required | Tor (complex) | Tor optional |
| **Authoring** | WordPress | Web editor | N/A | HTML editing |
| **Persistence** | Blockchain + P2P | Centralized | Temporary | DHT only |
| **Setup** | 10 minutes | Instant | Days (IT staff) | Complex |
| **Cost** | $0/month | $0-50/month | $500+ setup | $0/month |
| **Moderation** | Gateway-scoped | Platform-wide | N/A | None |
| **Discovery** | Full-text search | Platform | N/A | Hard |
| **Status** | Production | Active | Active | Inactive |

---

## Use Cases & Why It Works

**Journalist:** WordPress+Tor publishing survives SLAPP suits • **Whistleblower:** Air-gapped signing→courier→submission = complete anonymity • **Researcher:** Cryptographic provenance prevents suppression

**Success Factors:** WordPress (familiar) + Tor (built-in) + Pi (one-click) + $0/month + Gateway moderation (safe harbors) + 9 years proven + W3C standards

**Risks Mitigated:** Timing attacks (batched) • Liability (gateway moderation) • Exhaustion (caps/limits) • Spam (denylists) • Key loss (backup) • Blockchain failure (portable) • Tor blocking (air-gap) • Adoption (WordPress integration)

---

## The Vision & Call to Action

Whistleblowers, journalists, researchers, activists publish without fear. Information persists beyond any entity's control. **80% built. 4.5 months to 1.0.**

**Join:** Stakeholders (partnerships: Internet Archive, FPF, EFF) • Developers (github.com/DevonJames/oip-arweave-indexer) • Operators ($35 Pi, control moderation, support free speech)

**Contact:** amy@alexandria.io • based on v2.5 of PRD • Nov 2025 • 18 weeks to 1.0