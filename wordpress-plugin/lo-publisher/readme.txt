=== LO Publisher ===
Contributors: oipteam
Tags: publishing, blockchain, arweave, decentralized, oip
Requires at least: 5.8
Tested up to: 6.4
Stable tag: 1.0.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Publish WordPress content to the Open Index Protocol (OIP) - permanent, decentralized storage on Arweave, GUN, and Internet Archive.

== Description ==

LO Publisher (Library of Obscura Publisher) connects your WordPress site to the Open Index Protocol (OIP), enabling you to publish your content to multiple decentralized storage networks:

* **Arweave** - Permanent blockchain storage that lasts forever
* **GUN** - Real-time peer-to-peer synchronization
* **Internet Archive** - Anonymous submission via TOR

= Features =

* Gutenberg sidebar panel for easy publishing
* Multiple destination publishing in one click
* Field mapping from WordPress to OIP templates
* Publication status tracking
* Support for posts, images, and videos

= Requirements =

* WordPress 5.8 or higher
* PHP 7.4 or higher
* Onion Press Server instance (included with OIP deployment)

== Installation ==

1. Upload the `lo-publisher` folder to the `/wp-content/plugins/` directory
2. Activate the plugin through the 'Plugins' menu in WordPress
3. Go to Settings > LO Publisher to configure your Onion Press Server URL
4. Start publishing!

== Frequently Asked Questions ==

= What is OIP? =

The Open Index Protocol (OIP) is a decentralized publishing and indexing system that stores content on permanent blockchain storage (Arweave) and provides real-time synchronization via GUN.

= Do I need my own server? =

Yes, you need an Onion Press Server instance. This is included when you deploy OIP with the `onion-press-server` profile.

= Is publishing anonymous? =

Publishing to the Internet Archive via TOR provides anonymity. Publishing to Arweave and GUN uses your configured identity.

== Screenshots ==

1. Gutenberg sidebar panel
2. Settings page
3. Publishing status

== Changelog ==

= 1.0.0 =
* Initial release
* Gutenberg sidebar integration
* Multi-destination publishing
* TOR/Internet Archive support

== Upgrade Notice ==

= 1.0.0 =
Initial release of LO Publisher.

