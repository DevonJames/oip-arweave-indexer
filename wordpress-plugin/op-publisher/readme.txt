=== OP Publisher ===
Contributors: oipteam
Tags: decentralized, arweave, blockchain, publishing, ipfs, gun, oip
Requires at least: 5.8
Tested up to: 6.4
Stable tag: 2.0.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Publish WordPress content to the Open Index Protocol (OIP) - permanent, decentralized storage on Arweave, GUN, and Internet Archive via TOR.

== Description ==

**OP Publisher** (Onion Press Publisher) connects your WordPress site to the **Open Index Protocol (OIP)**, enabling permanent, censorship-resistant, decentralized publishing.

= Key Features =

* **Dual Publishing Modes**: Choose between mnemonic-based (login-less) or account-based (server) publishing
* **Multi-Destination Publishing**: Publish to Arweave, GUN, and Internet Archive simultaneously
* **Client-Side Signing**: In mnemonic mode, your identity never leaves your browser
* **Gutenberg Integration**: Seamless sidebar panel in the WordPress block editor
* **Status Tracking**: Monitor publishing status and view transaction details

= Publishing Modes =

**🔑 Mnemonic Mode (Recommended for Privacy)**
* Enter your 24-word BIP-39 mnemonic phrase
* All signing happens in your browser - the mnemonic never leaves your device
* Each author maintains their own decentralized identity
* Perfect for anonymous or pseudonymous publishing

**👤 Account Mode (Recommended for Publications)**
* Authenticate with an API token
* Server signs records on behalf of your publication
* All posts share the publication's identity
* Simplified workflow for teams

= Destinations =

* **Arweave**: Permanent, immutable blockchain storage
* **GUN**: Real-time peer-to-peer synchronization
* **Internet Archive**: Anonymous submission via TOR

= Requirements =

* Running instance of Onion Press Server (for browsing and account mode)
* Running instance of OIP Daemon (for mnemonic mode publishing)
* WordPress 5.8 or higher
* PHP 7.4 or higher

== Installation ==

1. Upload the `op-publisher` folder to `/wp-content/plugins/`
2. Activate the plugin through the 'Plugins' menu in WordPress
3. Go to Settings → OP Publisher to configure your connection
4. Open any post and use the 🧅 OP Publisher sidebar to publish

== Frequently Asked Questions ==

= Is my mnemonic phrase safe? =

In mnemonic mode, your mnemonic phrase is processed entirely in your browser using JavaScript. It is never sent to any server. The plugin uses the Web Crypto API for all cryptographic operations.

= What's the difference between the two modes? =

**Mnemonic Mode**: You control your own identity. Each post is signed with keys derived from your mnemonic. Best for individual authors who want their own decentralized identity.

**Account Mode**: The server controls the identity. All posts are signed by the server using its configured keys. Best for publications, organizations, or when you want a single identity for all content.

= Can I switch between modes? =

Yes! Each post can be published in either mode. The mode used is recorded in the post's metadata.

= What happens if the server goes down? =

Records published to Arweave are permanent and can be read from any Arweave gateway. Records on GUN sync across peers. Only Internet Archive submissions require the TOR connection to be active.

== Screenshots ==

1. Gutenberg sidebar showing mnemonic mode
2. Account mode with API token configured
3. Publishing destinations selection
4. Successful publication result
5. Admin settings page

== Changelog ==

= 2.0.0 =
* Complete rewrite with dual-mode publishing support
* Added mnemonic mode for login-less, client-side signing
* Added OIP v0.9 cryptographic signing
* Renamed from LO Publisher to OP Publisher
* New Gutenberg sidebar UI with tab-based mode selection
* Encrypted mnemonic storage option
* Migration from LO Publisher settings

= 1.0.0 =
* Initial release as LO Publisher
* Basic field mapping
* Arweave and GUN publishing
* Admin settings page

== Upgrade Notice ==

= 2.0.0 =
Major update with new mnemonic-based publishing mode. Your existing settings will be migrated automatically.
