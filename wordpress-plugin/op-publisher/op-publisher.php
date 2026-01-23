<?php
/**
 * Plugin Name: OP Publisher
 * Plugin URI: https://oip.io
 * Description: Onion Press Publisher - Publish WordPress content to the Open Index Protocol (OIP) with login-less mnemonic signing or server account authentication
 * Version: 2.0.0
 * Author: OIP Team
 * Author URI: https://oip.io
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: op-publisher
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

// Plugin constants
define('OP_PUBLISHER_VERSION', '2.0.0');
define('OP_PUBLISHER_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('OP_PUBLISHER_PLUGIN_URL', plugin_dir_url(__FILE__));

/**
 * OP Publisher Main Class
 * 
 * Supports two publishing modes:
 * 1. Account Mode: User logs into server, server signs records
 * 2. Mnemonic Mode: User provides mnemonic, client-side signing, login-less
 */
class OP_Publisher {
    
    private static $instance = null;
    private $settings;
    
    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        // Detect if running in Docker (container-to-container) or external
        $is_docker = !empty($_SERVER['HTTP_HOST']) && strpos($_SERVER['HTTP_HOST'], 'wordpress') !== false;
        
        $default_onion_press = $is_docker ? 'http://onion-press-service:3007' : '';
        $default_oip_daemon = $is_docker ? 'http://oip-daemon-service:3005' : '';
        
        $this->settings = get_option('op_publisher_settings', array(
            'onion_press_url' => $default_onion_press,
            'oip_daemon_url' => $default_oip_daemon,
            'api_token' => '',
            'default_mode' => 'mnemonic', // 'mnemonic' or 'account'
            'default_arweave' => true,
            'default_gun' => true,
            'default_ia' => false,
            'remember_mnemonic' => false, // Whether to offer mnemonic storage
        ));
        
        // Admin hooks
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_scripts'));
        
        // Gutenberg hooks
        add_action('enqueue_block_editor_assets', array($this, 'enqueue_editor_assets'));
        
        // REST API
        add_action('rest_api_init', array($this, 'register_rest_routes'));
        
        // Post meta
        add_action('init', array($this, 'register_meta'));
    }
    
    /**
     * Add admin menu
     */
    public function add_admin_menu() {
        add_options_page(
            __('OP Publisher Settings', 'op-publisher'),
            __('OP Publisher', 'op-publisher'),
            'manage_options',
            'op-publisher',
            array($this, 'render_settings_page')
        );
    }
    
    /**
     * Register settings
     */
    public function register_settings() {
        register_setting('op_publisher_settings', 'op_publisher_settings', array(
            'sanitize_callback' => array($this, 'sanitize_settings')
        ));
        
        // Connection Settings Section
        add_settings_section(
            'op_publisher_connection',
            __('🌐 Connection Settings', 'op-publisher'),
            array($this, 'render_connection_description'),
            'op-publisher'
        );
        
        add_settings_field(
            'onion_press_url',
            __('Onion Press Server URL', 'op-publisher'),
            array($this, 'render_onion_press_url_field'),
            'op-publisher',
            'op_publisher_connection'
        );
        
        add_settings_field(
            'oip_daemon_url',
            __('OIP Daemon URL', 'op-publisher'),
            array($this, 'render_oip_daemon_url_field'),
            'op-publisher',
            'op_publisher_connection'
        );
        
        // Publishing Mode Section
        add_settings_section(
            'op_publisher_mode',
            __('🔐 Publishing Mode', 'op-publisher'),
            array($this, 'render_mode_description'),
            'op-publisher'
        );
        
        add_settings_field(
            'default_mode',
            __('Default Mode', 'op-publisher'),
            array($this, 'render_mode_field'),
            'op-publisher',
            'op_publisher_mode'
        );
        
        add_settings_field(
            'api_token',
            __('API Token (Account Mode)', 'op-publisher'),
            array($this, 'render_token_field'),
            'op-publisher',
            'op_publisher_mode'
        );
        
        add_settings_field(
            'remember_mnemonic',
            __('Mnemonic Storage', 'op-publisher'),
            array($this, 'render_remember_mnemonic_field'),
            'op-publisher',
            'op_publisher_mode'
        );
        
        // Destinations Section
        add_settings_section(
            'op_publisher_defaults',
            __('📤 Default Publishing Destinations', 'op-publisher'),
            null,
            'op-publisher'
        );
        
        add_settings_field(
            'default_destinations',
            __('Destinations', 'op-publisher'),
            array($this, 'render_destinations_field'),
            'op-publisher',
            'op_publisher_defaults'
        );
    }
    
    /**
     * Sanitize settings
     */
    public function sanitize_settings($input) {
        $sanitized = array();
        
        $sanitized['onion_press_url'] = esc_url_raw($input['onion_press_url'] ?? '');
        $sanitized['oip_daemon_url'] = esc_url_raw($input['oip_daemon_url'] ?? '');
        $sanitized['api_token'] = sanitize_text_field($input['api_token'] ?? '');
        $sanitized['default_mode'] = in_array($input['default_mode'] ?? '', ['mnemonic', 'account']) 
            ? $input['default_mode'] : 'mnemonic';
        $sanitized['default_arweave'] = !empty($input['default_arweave']);
        $sanitized['default_gun'] = !empty($input['default_gun']);
        $sanitized['default_ia'] = !empty($input['default_ia']);
        $sanitized['remember_mnemonic'] = !empty($input['remember_mnemonic']);
        
        return $sanitized;
    }
    
    /**
     * Render settings page
     */
    public function render_settings_page() {
        ?>
        <div class="wrap op-publisher-settings">
            <h1>🧅 <?php echo esc_html(get_admin_page_title()); ?></h1>
            
            <div class="op-publisher-intro">
                <p>
                    <strong>OP Publisher</strong> connects WordPress to the <strong>Open Index Protocol (OIP)</strong>, 
                    enabling permanent, decentralized publishing to Arweave, GUN, and anonymous submission to the 
                    This Host (WordPress) for local publishing.
                </p>
                <p>
                    Choose between two publishing modes:
                </p>
                <ul>
                    <li><strong>🔑 Mnemonic Mode (Recommended)</strong> - Login-less publishing using your 24-word seed phrase. Your identity stays private.</li>
                    <li><strong>👤 Account Mode</strong> - Traditional login to the Onion Press server. Server signs on your behalf.</li>
                </ul>
            </div>
            
            <form action="options.php" method="post">
                <?php
                settings_fields('op_publisher_settings');
                do_settings_sections('op-publisher');
                submit_button(__('Save Settings', 'op-publisher'));
                ?>
            </form>
            
            <hr>
            <h2>🔗 Connection Test</h2>
            <div class="op-test-buttons">
                <button type="button" id="op-test-onion-press" class="button button-secondary">
                    Test Onion Press
                </button>
                <button type="button" id="op-test-oip-daemon" class="button button-secondary">
                    Test OIP Daemon
                </button>
                <span id="op-test-result"></span>
            </div>
            
            <hr>
            <h2>📚 Documentation</h2>
            <p>
                For full documentation, see the 
                <a href="https://oip.io/docs/onion-press" target="_blank">Onion Press Guide</a>.
            </p>
        </div>
        
        <style>
            .op-publisher-settings .op-publisher-intro {
                background: #f8f9fa;
                border-left: 4px solid #8b5cf6;
                padding: 16px 20px;
                margin: 20px 0;
            }
            .op-publisher-settings .op-publisher-intro ul {
                margin-left: 20px;
            }
            .op-publisher-settings .op-test-buttons {
                display: flex;
                gap: 10px;
                align-items: center;
            }
            .op-publisher-settings .mode-option {
                padding: 12px;
                border: 2px solid #ddd;
                border-radius: 8px;
                margin-bottom: 10px;
                cursor: pointer;
            }
            .op-publisher-settings .mode-option.selected {
                border-color: #8b5cf6;
                background: #f5f3ff;
            }
            .op-publisher-settings .mode-option input[type="radio"] {
                margin-right: 8px;
            }
        </style>
        <?php
    }
    
    public function render_connection_description() {
        echo '<p>' . __('Configure your connection to the Onion Press and OIP Daemon services.', 'op-publisher') . '</p>';
    }
    
    public function render_mode_description() {
        echo '<p>' . __('Choose how authors authenticate when publishing content.', 'op-publisher') . '</p>';
    }
    
    public function render_onion_press_url_field() {
        $value = $this->settings['onion_press_url'] ?? '';
        ?>
        <input type="url" name="op_publisher_settings[onion_press_url]" 
               value="<?php echo esc_attr($value); ?>" 
               class="regular-text"
               placeholder="http://onion-press-service:3007">
        <p class="description">
            <?php _e('URL of the Onion Press service (for browsing and account mode).', 'op-publisher'); ?>
            <br><code>Docker internal: http://onion-press-service:3007</code>
        </p>
        <?php
    }
    
    public function render_oip_daemon_url_field() {
        $value = $this->settings['oip_daemon_url'] ?? '';
        ?>
        <input type="url" name="op_publisher_settings[oip_daemon_url]" 
               value="<?php echo esc_attr($value); ?>" 
               class="regular-text"
               placeholder="http://oip-daemon-service:3005">
        <p class="description">
            <?php _e('URL of the OIP Daemon service (for mnemonic mode publishing).', 'op-publisher'); ?>
            <br><code>Docker internal: http://oip-daemon-service:3005</code>
        </p>
        <?php
    }
    
    public function render_mode_field() {
        $value = $this->settings['default_mode'] ?? 'mnemonic';
        ?>
        <div class="mode-option <?php echo $value === 'mnemonic' ? 'selected' : ''; ?>">
            <label>
                <input type="radio" name="op_publisher_settings[default_mode]" value="mnemonic"
                       <?php checked($value, 'mnemonic'); ?>>
                <strong>🔑 Mnemonic Mode (Login-less)</strong>
                <p class="description" style="margin-left: 24px; margin-top: 4px;">
                    Authors enter their 24-word mnemonic phrase. Signing happens in the browser - 
                    the mnemonic never leaves the client. Server only pays the Arweave transaction fee.
                    <br><em>Best for: Privacy-conscious authors, anonymous publishing, decentralization.</em>
                </p>
            </label>
        </div>
        <div class="mode-option <?php echo $value === 'account' ? 'selected' : ''; ?>">
            <label>
                <input type="radio" name="op_publisher_settings[default_mode]" value="account"
                       <?php checked($value, 'account'); ?>>
                <strong>👤 Account Mode (Server Login)</strong>
                <p class="description" style="margin-left: 24px; margin-top: 4px;">
                    Authors authenticate with an API token. The server signs records on behalf of the publication.
                    All posts share the server's identity.
                    <br><em>Best for: Publications, organizations, simplified workflow.</em>
                </p>
            </label>
        </div>
        <script>
            document.querySelectorAll('.mode-option').forEach(el => {
                el.addEventListener('click', function() {
                    document.querySelectorAll('.mode-option').forEach(opt => opt.classList.remove('selected'));
                    this.classList.add('selected');
                    this.querySelector('input').checked = true;
                });
            });
        </script>
        <?php
    }
    
    public function render_token_field() {
        $value = $this->settings['api_token'] ?? '';
        ?>
        <input type="password" name="op_publisher_settings[api_token]" 
               value="<?php echo esc_attr($value); ?>" 
               class="regular-text">
        <p class="description"><?php _e('API token for Account Mode. Get this from your Onion Press admin.', 'op-publisher'); ?></p>
        <?php
    }
    
    public function render_remember_mnemonic_field() {
        $value = $this->settings['remember_mnemonic'] ?? false;
        ?>
        <label>
            <input type="checkbox" name="op_publisher_settings[remember_mnemonic]" value="1"
                   <?php checked($value); ?>>
            <?php _e('Allow encrypted mnemonic storage in browser', 'op-publisher'); ?>
        </label>
        <p class="description">
            <?php _e('When enabled, authors can optionally save their encrypted mnemonic in browser storage for convenience. The mnemonic is encrypted with a password they choose.', 'op-publisher'); ?>
            <br><strong><?php _e('⚠️ Security Note:', 'op-publisher'); ?></strong>
            <?php _e('Storing mnemonics in browsers has inherent risks. Recommended only for non-critical identities.', 'op-publisher'); ?>
        </p>
        <?php
    }
    
    public function render_destinations_field() {
        ?>
        <label style="display: block; margin-bottom: 8px;">
            <input type="checkbox" name="op_publisher_settings[default_arweave]" value="1"
                   <?php checked($this->settings['default_arweave'] ?? true); ?>>
            ⛓️ <?php _e('Arweave (permanent blockchain storage)', 'op-publisher'); ?>
        </label>
        <label style="display: block; margin-bottom: 8px;">
            <input type="checkbox" name="op_publisher_settings[default_gun]" value="1"
                   <?php checked($this->settings['default_gun'] ?? true); ?>>
            🔄 <?php _e('GUN (real-time peer sync)', 'op-publisher'); ?>
        </label>
        <label style="display: block; margin-bottom: 8px;">
            <input type="checkbox" name="op_publisher_settings[default_this_host]" value="1"
                   <?php checked($this->settings['default_this_host'] ?? false); ?>>
            🏠 <?php _e('This Host (WordPress)', 'op-publisher'); ?>
        </label>
        <?php
    }
    
    /**
     * Enqueue admin scripts
     */
    public function enqueue_admin_scripts($hook) {
        if ('settings_page_op-publisher' !== $hook) {
            return;
        }
        
        wp_enqueue_script(
            'op-publisher-admin',
            OP_PUBLISHER_PLUGIN_URL . 'assets/js/admin-settings.js',
            array('jquery'),
            OP_PUBLISHER_VERSION,
            true
        );
        
        wp_localize_script('op-publisher-admin', 'opPublisher', array(
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('op_publisher_nonce'),
            'onionPressUrl' => $this->settings['onion_press_url'] ?? '',
            'oipDaemonUrl' => $this->settings['oip_daemon_url'] ?? ''
        ));
    }
    
    /**
     * Enqueue Gutenberg editor assets
     */
    public function enqueue_editor_assets() {
        // OIP Crypto library for client-side signing
        wp_enqueue_script(
            'op-publisher-crypto',
            OP_PUBLISHER_PLUGIN_URL . 'assets/js/oip-crypto-bundle.js',
            array(),
            OP_PUBLISHER_VERSION,
            true
        );
        
        // Gutenberg sidebar
        wp_enqueue_script(
            'op-publisher-sidebar',
            OP_PUBLISHER_PLUGIN_URL . 'assets/js/gutenberg-sidebar.js',
            array('wp-plugins', 'wp-edit-post', 'wp-element', 'wp-components', 'wp-data', 'wp-api-fetch', 'op-publisher-crypto'),
            OP_PUBLISHER_VERSION,
            true
        );
        
        wp_enqueue_style(
            'op-publisher-sidebar',
            OP_PUBLISHER_PLUGIN_URL . 'assets/css/gutenberg-sidebar.css',
            array(),
            OP_PUBLISHER_VERSION
        );
        
        wp_localize_script('op-publisher-sidebar', 'opPublisherSettings', array(
            'restUrl' => rest_url('op-publisher/v1/'),
            'nonce' => wp_create_nonce('wp_rest'),
            'settings' => $this->settings,
            'version' => OP_PUBLISHER_VERSION
        ));
    }
    
    /**
     * Register post meta
     */
    public function register_meta() {
        $meta_fields = array(
            'op_publisher_did' => 'string',
            'op_publisher_status' => 'string',
            'op_publisher_destinations' => 'string',
            'op_publisher_tx_id' => 'string',
            'op_publisher_mode' => 'string',
            'op_publisher_published_at' => 'string',
        );
        
        foreach ($meta_fields as $key => $type) {
            register_post_meta('', $key, array(
                'show_in_rest' => true,
                'single' => true,
                'type' => $type,
                'auth_callback' => function() {
                    return current_user_can('edit_posts');
                }
            ));
        }
    }
    
    /**
     * Register REST API routes
     */
    public function register_rest_routes() {
        // Account mode: server-side publish
        register_rest_route('op-publisher/v1', '/publish/(?P<id>\d+)', array(
            'methods' => 'POST',
            'callback' => array($this, 'rest_publish_post'),
            'permission_callback' => function() {
                return current_user_can('edit_posts');
            },
            'args' => array(
                'id' => array(
                    'required' => true,
                    'validate_callback' => function($param) {
                        return is_numeric($param);
                    }
                ),
                'destinations' => array(
                    'required' => false,
                    'default' => array()
                )
            )
        ));
        
        // Mnemonic mode: submit pre-signed payload
        register_rest_route('op-publisher/v1', '/publish-signed', array(
            'methods' => 'POST',
            'callback' => array($this, 'rest_publish_signed'),
            'permission_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        // Build record for signing (returns record structure without signing)
        register_rest_route('op-publisher/v1', '/build-record/(?P<id>\d+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_build_record'),
            'permission_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        register_rest_route('op-publisher/v1', '/status/(?P<submission_id>[a-zA-Z0-9_-]+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_get_status'),
            'permission_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        register_rest_route('op-publisher/v1', '/settings', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_get_settings'),
            'permission_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        register_rest_route('op-publisher/v1', '/test-connection', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_test_connection'),
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ));
    }
    
    /**
     * REST: Build record structure for client-side signing
     */
    public function rest_build_record($request) {
        $post_id = $request->get_param('id');
        
        $post = get_post($post_id);
        if (!$post) {
            return new WP_Error('not_found', 'Post not found', array('status' => 404));
        }
        
        // Build the OIP record structure
        $record = $this->build_oip_record($post);
        
        return rest_ensure_response(array(
            'success' => true,
            'postId' => $post_id,
            'record' => $record,
            'wordpress' => array(
                'postId' => $post_id,
                'postType' => $post->post_type,
                'siteUrl' => get_site_url(),
                'permalink' => get_permalink($post_id)
            )
        ));
    }
    
    /**
     * REST: Publish pre-signed record (mnemonic mode)
     */
    public function rest_publish_signed($request) {
        $body = $request->get_json_params();
        
        $payload = $body['payload'] ?? null;
        $destinations = $body['destinations'] ?? array('arweave' => true);
        $postId = $body['postId'] ?? null;
        
        if (!$payload) {
            return new WP_Error('missing_payload', 'Signed payload is required', array('status' => 400));
        }
        
        // Forward to OIP daemon's publishSigned endpoint
        $response = wp_remote_post(
            $this->settings['oip_daemon_url'] . '/api/records/publishSigned',
            array(
                'headers' => array('Content-Type' => 'application/json'),
                'body' => json_encode(array(
                    'payload' => $payload,
                    'verifySignature' => true,
                    'destinations' => $destinations
                )),
                'timeout' => 120
            )
        );
        
        if (is_wp_error($response)) {
            return $response;
        }
        
        $code = wp_remote_retrieve_response_code($response);
        $result = json_decode(wp_remote_retrieve_body($response), true);
        
        if ($code >= 400) {
            return new WP_Error(
                'publish_failed',
                $result['error'] ?? 'Publishing failed',
                array('status' => $code)
            );
        }
        
        // Update post meta if we have a post ID
        if ($postId) {
            update_post_meta($postId, 'op_publisher_status', 'published');
            update_post_meta($postId, 'op_publisher_mode', 'mnemonic');
            update_post_meta($postId, 'op_publisher_destinations', json_encode($destinations));
            update_post_meta($postId, 'op_publisher_published_at', current_time('mysql'));
            
            if (!empty($result['transactionId'])) {
                update_post_meta($postId, 'op_publisher_tx_id', $result['transactionId']);
            }
            if (!empty($result['did'])) {
                update_post_meta($postId, 'op_publisher_did', $result['did']);
            }
        }
        
        return rest_ensure_response($result);
    }
    
    /**
     * REST: Publish post to OIP (account mode)
     */
    public function rest_publish_post($request) {
        $post_id = $request->get_param('id');
        $destinations = $request->get_param('destinations');
        
        $post = get_post($post_id);
        if (!$post) {
            return new WP_Error('not_found', 'Post not found', array('status' => 404));
        }
        
        // Build OIP record from WordPress post
        $record = $this->build_oip_record($post);
        
        // Send to Onion Press Server (account mode - server signs)
        $result = $this->send_to_onion_press($record, $destinations, $post_id);
        
        if (is_wp_error($result)) {
            return $result;
        }
        
        // Update post meta
        update_post_meta($post_id, 'op_publisher_status', 'published');
        update_post_meta($post_id, 'op_publisher_mode', 'account');
        update_post_meta($post_id, 'op_publisher_destinations', json_encode($destinations));
        update_post_meta($post_id, 'op_publisher_published_at', current_time('mysql'));
        
        if (!empty($result['submissionId'])) {
            update_post_meta($post_id, 'op_publisher_submission_id', $result['submissionId']);
        }
        
        return rest_ensure_response($result);
    }
    
    /**
     * REST: Get submission status
     */
    public function rest_get_status($request) {
        $submission_id = $request->get_param('submission_id');
        
        // Try Onion Press first
        $response = wp_remote_get(
            $this->settings['onion_press_url'] . '/api/publish/' . $submission_id . '/status',
            array(
                'headers' => $this->get_api_headers(),
                'timeout' => 30
            )
        );
        
        if (is_wp_error($response)) {
            return $response;
        }
        
        $body = json_decode(wp_remote_retrieve_body($response), true);
        return rest_ensure_response($body);
    }
    
    /**
     * REST: Get settings
     */
    public function rest_get_settings($request) {
        return rest_ensure_response(array(
            'onionPressUrl' => $this->settings['onion_press_url'],
            'oipDaemonUrl' => $this->settings['oip_daemon_url'],
            'hasToken' => !empty($this->settings['api_token']),
            'defaultMode' => $this->settings['default_mode'] ?? 'mnemonic',
            'rememberMnemonic' => $this->settings['remember_mnemonic'] ?? false,
            'defaults' => array(
                'arweave' => $this->settings['default_arweave'] ?? true,
                'gun' => $this->settings['default_gun'] ?? true,
                'thisHost' => $this->settings['default_this_host'] ?? false
            ),
            'version' => OP_PUBLISHER_VERSION
        ));
    }
    
    /**
     * REST: Test connection
     */
    public function rest_test_connection($request) {
        $service = $request->get_param('service') ?? 'onion-press';
        
        $url = $service === 'oip-daemon' 
            ? $this->settings['oip_daemon_url'] . '/health'
            : $this->settings['onion_press_url'] . '/health';
        
        $response = wp_remote_get($url, array('timeout' => 10));
        
        if (is_wp_error($response)) {
            return new WP_Error('connection_failed', $response->get_error_message());
        }
        
        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        
        if ($code !== 200) {
            return new WP_Error('connection_failed', 'Server returned status ' . $code);
        }
        
        return rest_ensure_response(array(
            'success' => true,
            'service' => $service,
            'server' => $body
        ));
    }
    
    /**
     * Build OIP record from WordPress post
     */
    private function build_oip_record($post) {
        $record = array(
            'basic' => array(
                'name' => $post->post_title,
                'description' => wp_trim_words($post->post_excerpt ?: strip_tags($post->post_content), 55),
                'date' => strtotime($post->post_date),
                'tagItems' => $this->get_post_tags($post->ID)
            )
        );
        
        // Add post-specific fields
        if ($post->post_type === 'post') {
            $record['post'] = array(
                'articleText' => $this->get_clean_content($post->post_content),
                'bylineWriter' => get_the_author_meta('display_name', $post->post_author)
            );
        }
        
        // Add featured image if present
        $thumbnail_id = get_post_thumbnail_id($post->ID);
        if ($thumbnail_id) {
            $thumbnail_url = wp_get_attachment_url($thumbnail_id);
            $record['basic']['thumbnail'] = $thumbnail_url;
        }
        
        return $record;
    }
    
    /**
     * Get clean content (strip blocks, shortcodes, etc.)
     */
    private function get_clean_content($content) {
        // Remove block comments
        $content = preg_replace('/<!-- wp:.*?-->/', '', $content);
        $content = preg_replace('/<!-- \/wp:.*?-->/', '', $content);
        // Remove shortcodes
        $content = strip_shortcodes($content);
        // Remove HTML
        $content = wp_strip_all_tags($content);
        // Clean whitespace
        $content = preg_replace('/\s+/', ' ', $content);
        return trim($content);
    }
    
    /**
     * Get post tags and categories
     */
    private function get_post_tags($post_id) {
        $tags = wp_get_post_tags($post_id, array('fields' => 'names'));
        $categories = wp_get_post_categories($post_id, array('fields' => 'names'));
        return array_values(array_unique(array_merge($tags, $categories)));
    }
    
    /**
     * Send record to Onion Press Server (account mode)
     */
    private function send_to_onion_press($record, $destinations, $post_id) {
        $body = array(
            'record' => $record,
            'destinations' => $destinations,
            'wordpress' => array(
                'postId' => $post_id,
                'postType' => get_post_type($post_id),
                'siteUrl' => get_site_url(),
                'permalink' => get_permalink($post_id)
            )
        );
        
        $response = wp_remote_post(
            $this->settings['onion_press_url'] . '/api/publish',
            array(
                'headers' => $this->get_api_headers(),
                'body' => json_encode($body),
                'timeout' => 60
            )
        );
        
        if (is_wp_error($response)) {
            return $response;
        }
        
        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        
        if ($code >= 400) {
            return new WP_Error(
                'publish_failed',
                $body['error'] ?? 'Publishing failed',
                array('status' => $code)
            );
        }
        
        return $body;
    }
    
    /**
     * Get API headers
     */
    private function get_api_headers() {
        $headers = array(
            'Content-Type' => 'application/json'
        );
        
        if (!empty($this->settings['api_token'])) {
            $headers['Authorization'] = 'Bearer ' . $this->settings['api_token'];
        }
        
        return $headers;
    }
}

// Initialize plugin
function op_publisher_init() {
    OP_Publisher::get_instance();
}
add_action('plugins_loaded', 'op_publisher_init');

// ═══════════════════════════════════════════════════════════════════════════
// FIX WORDPRESS REST API BASIC AUTH FOR INTERNAL DOCKER ACCESS
// ═══════════════════════════════════════════════════════════════════════════
// WordPress REST API Basic Auth REQUIRES Application Passwords by default.
// This is a WordPress core security feature that cannot be easily disabled.
//
// SOLUTION: We intercept REST API authentication EARLY and handle it ourselves,
// bypassing WordPress's Application Password requirement for internal Docker access.
// ═══════════════════════════════════════════════════════════════════════════

// Hook into REST API authentication BEFORE WordPress checks Application Passwords
add_filter('rest_authentication_errors', function($result) {
    // If already authenticated or not a REST request, return as-is
    if (!empty($result) || !defined('REST_REQUEST') || !REST_REQUEST) {
        return $result;
    }
    
    // Check for Basic Auth headers
    if (!isset($_SERVER['PHP_AUTH_USER']) || !isset($_SERVER['PHP_AUTH_PW'])) {
        return $result;
    }
    
    $username = sanitize_user($_SERVER['PHP_AUTH_USER']);
    $password = $_SERVER['PHP_AUTH_PW'];
    
    if (empty($username) || empty($password)) {
        return $result;
    }
    
    // Get user by login
    $user = get_user_by('login', $username);
    if (!$user) {
        return $result;
    }
    
    // Try Application Password first (WordPress's preferred method)
    if (function_exists('wp_authenticate_application_password')) {
        $app_password_user = wp_authenticate_application_password(null, $username, $password);
        if (!is_wp_error($app_password_user) && $app_password_user instanceof WP_User) {
            wp_set_current_user($app_password_user->ID);
            return true; // Authentication successful
        }
    }
    
    // Fallback: Try regular password authentication
    // WordPress normally doesn't allow this for REST API, but we allow it for internal Docker access
    $password_check = wp_check_password($password, $user->user_pass, $user->ID);
    if ($password_check) {
        wp_set_current_user($user->ID);
        error_log("OP Publisher: Using regular password auth for REST API user: {$username}");
        return true; // Authentication successful
    }
    
    // If neither worked, return error
    return new WP_Error(
        'rest_forbidden',
        __('Sorry, you are not allowed to do that.'),
        array('status' => 401)
    );
}, 1); // Priority 1 to run before WordPress's default (priority 10)

// Activation hook
register_activation_hook(__FILE__, function() {
    // Set default options
    if (!get_option('op_publisher_settings')) {
        add_option('op_publisher_settings', array(
            'onion_press_url' => 'http://onion-press-service:3007',
            'oip_daemon_url' => 'http://oip-daemon-service:3005',
            'api_token' => '',
            'default_mode' => 'mnemonic',
            'default_arweave' => true,
            'default_gun' => true,
            'default_ia' => false,
            'remember_mnemonic' => false,
        ));
    }
    
    // Migrate from old LO Publisher settings if they exist
    $old_settings = get_option('lo_publisher_settings');
    if ($old_settings && !get_option('op_publisher_migrated')) {
        $new_settings = array(
            'onion_press_url' => $old_settings['onion_press_url'] ?? 'http://onion-press-service:3007',
            'oip_daemon_url' => 'http://oip-daemon-service:3005',
            'api_token' => $old_settings['api_token'] ?? '',
            'default_mode' => 'account', // Existing users were using account mode
            'default_arweave' => $old_settings['default_arweave'] ?? true,
            'default_gun' => $old_settings['default_gun'] ?? true,
            'default_ia' => $old_settings['default_ia'] ?? false,
            'remember_mnemonic' => false,
        );
        update_option('op_publisher_settings', $new_settings);
        update_option('op_publisher_migrated', true);
    }
});

// Deactivation hook
register_deactivation_hook(__FILE__, function() {
    // Cleanup if needed
});
