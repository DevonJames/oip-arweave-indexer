<?php
/**
 * Plugin Name: LO Publisher
 * Plugin URI: https://oip.io
 * Description: Publish WordPress content to the Open Index Protocol (OIP) - Arweave, GUN, and Internet Archive
 * Version: 1.0.0
 * Author: OIP Team
 * Author URI: https://oip.io
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: lo-publisher
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

// Plugin constants
define('LO_PUBLISHER_VERSION', '1.0.0');
define('LO_PUBLISHER_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('LO_PUBLISHER_PLUGIN_URL', plugin_dir_url(__FILE__));

/**
 * LO Publisher Main Class
 */
class LO_Publisher {
    
    private static $instance = null;
    private $settings;
    
    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        $this->settings = get_option('lo_publisher_settings', array(
            'onion_press_url' => 'http://onion-press-service:3007',
            'api_token' => '',
            'default_arweave' => true,
            'default_gun' => true,
            'default_ia' => false,
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
            __('LO Publisher Settings', 'lo-publisher'),
            __('LO Publisher', 'lo-publisher'),
            'manage_options',
            'lo-publisher',
            array($this, 'render_settings_page')
        );
    }
    
    /**
     * Register settings
     */
    public function register_settings() {
        register_setting('lo_publisher_settings', 'lo_publisher_settings', array(
            'sanitize_callback' => array($this, 'sanitize_settings')
        ));
        
        add_settings_section(
            'lo_publisher_main',
            __('Connection Settings', 'lo-publisher'),
            array($this, 'render_section_description'),
            'lo-publisher'
        );
        
        add_settings_field(
            'onion_press_url',
            __('Onion Press Server URL', 'lo-publisher'),
            array($this, 'render_url_field'),
            'lo-publisher',
            'lo_publisher_main'
        );
        
        add_settings_field(
            'api_token',
            __('API Token', 'lo-publisher'),
            array($this, 'render_token_field'),
            'lo-publisher',
            'lo_publisher_main'
        );
        
        add_settings_section(
            'lo_publisher_defaults',
            __('Default Publishing Destinations', 'lo-publisher'),
            null,
            'lo-publisher'
        );
        
        add_settings_field(
            'default_destinations',
            __('Destinations', 'lo-publisher'),
            array($this, 'render_destinations_field'),
            'lo-publisher',
            'lo_publisher_defaults'
        );
    }
    
    /**
     * Sanitize settings
     */
    public function sanitize_settings($input) {
        $sanitized = array();
        
        $sanitized['onion_press_url'] = esc_url_raw($input['onion_press_url'] ?? '');
        $sanitized['api_token'] = sanitize_text_field($input['api_token'] ?? '');
        $sanitized['default_arweave'] = !empty($input['default_arweave']);
        $sanitized['default_gun'] = !empty($input['default_gun']);
        $sanitized['default_ia'] = !empty($input['default_ia']);
        
        return $sanitized;
    }
    
    /**
     * Render settings page
     */
    public function render_settings_page() {
        ?>
        <div class="wrap">
            <h1><?php echo esc_html(get_admin_page_title()); ?></h1>
            <form action="options.php" method="post">
                <?php
                settings_fields('lo_publisher_settings');
                do_settings_sections('lo-publisher');
                submit_button(__('Save Settings', 'lo-publisher'));
                ?>
            </form>
            
            <hr>
            <h2><?php _e('Connection Test', 'lo-publisher'); ?></h2>
            <button type="button" id="lo-test-connection" class="button button-secondary">
                <?php _e('Test Connection', 'lo-publisher'); ?>
            </button>
            <span id="lo-test-result"></span>
        </div>
        <?php
    }
    
    public function render_section_description() {
        echo '<p>' . __('Configure your connection to the Onion Press Server.', 'lo-publisher') . '</p>';
    }
    
    public function render_url_field() {
        $value = $this->settings['onion_press_url'] ?? 'http://onion-press-service:3007';
        ?>
        <input type="url" name="lo_publisher_settings[onion_press_url]" 
               value="<?php echo esc_attr($value); ?>" 
               class="regular-text">
        <p class="description"><?php _e('The URL of your Onion Press Server instance.', 'lo-publisher'); ?></p>
        <?php
    }
    
    public function render_token_field() {
        $value = $this->settings['api_token'] ?? '';
        ?>
        <input type="password" name="lo_publisher_settings[api_token]" 
               value="<?php echo esc_attr($value); ?>" 
               class="regular-text">
        <p class="description"><?php _e('Your API token for authenticated publishing.', 'lo-publisher'); ?></p>
        <?php
    }
    
    public function render_destinations_field() {
        ?>
        <label>
            <input type="checkbox" name="lo_publisher_settings[default_arweave]" value="1"
                   <?php checked($this->settings['default_arweave'] ?? true); ?>>
            <?php _e('Arweave (permanent blockchain storage)', 'lo-publisher'); ?>
        </label><br>
        <label>
            <input type="checkbox" name="lo_publisher_settings[default_gun]" value="1"
                   <?php checked($this->settings['default_gun'] ?? true); ?>>
            <?php _e('GUN (real-time peer sync)', 'lo-publisher'); ?>
        </label><br>
        <label>
            <input type="checkbox" name="lo_publisher_settings[default_ia]" value="1"
                   <?php checked($this->settings['default_ia'] ?? false); ?>>
            <?php _e('Internet Archive (via TOR)', 'lo-publisher'); ?>
        </label>
        <?php
    }
    
    /**
     * Enqueue admin scripts
     */
    public function enqueue_admin_scripts($hook) {
        if ('settings_page_lo-publisher' !== $hook) {
            return;
        }
        
        wp_enqueue_script(
            'lo-publisher-admin',
            LO_PUBLISHER_PLUGIN_URL . 'assets/js/admin-settings.js',
            array('jquery'),
            LO_PUBLISHER_VERSION,
            true
        );
        
        wp_localize_script('lo-publisher-admin', 'loPublisher', array(
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('lo_publisher_nonce'),
            'serverUrl' => $this->settings['onion_press_url'] ?? ''
        ));
    }
    
    /**
     * Enqueue Gutenberg editor assets
     */
    public function enqueue_editor_assets() {
        wp_enqueue_script(
            'lo-publisher-sidebar',
            LO_PUBLISHER_PLUGIN_URL . 'assets/js/gutenberg-sidebar.js',
            array('wp-plugins', 'wp-edit-post', 'wp-element', 'wp-components', 'wp-data', 'wp-api-fetch'),
            LO_PUBLISHER_VERSION,
            true
        );
        
        wp_enqueue_style(
            'lo-publisher-sidebar',
            LO_PUBLISHER_PLUGIN_URL . 'assets/css/gutenberg-sidebar.css',
            array(),
            LO_PUBLISHER_VERSION
        );
        
        wp_localize_script('lo-publisher-sidebar', 'loPublisherSettings', array(
            'restUrl' => rest_url('lo-publisher/v1/'),
            'nonce' => wp_create_nonce('wp_rest'),
            'settings' => $this->settings
        ));
    }
    
    /**
     * Register post meta
     */
    public function register_meta() {
        register_post_meta('', 'lo_publisher_did', array(
            'show_in_rest' => true,
            'single' => true,
            'type' => 'string',
            'auth_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        register_post_meta('', 'lo_publisher_status', array(
            'show_in_rest' => true,
            'single' => true,
            'type' => 'string',
            'auth_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        register_post_meta('', 'lo_publisher_destinations', array(
            'show_in_rest' => true,
            'single' => true,
            'type' => 'string',
            'auth_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
    }
    
    /**
     * Register REST API routes
     */
    public function register_rest_routes() {
        register_rest_route('lo-publisher/v1', '/publish/(?P<id>\d+)', array(
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
        
        register_rest_route('lo-publisher/v1', '/status/(?P<submission_id>[a-zA-Z0-9_]+)', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_get_status'),
            'permission_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        register_rest_route('lo-publisher/v1', '/settings', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_get_settings'),
            'permission_callback' => function() {
                return current_user_can('edit_posts');
            }
        ));
        
        register_rest_route('lo-publisher/v1', '/test-connection', array(
            'methods' => 'GET',
            'callback' => array($this, 'rest_test_connection'),
            'permission_callback' => function() {
                return current_user_can('manage_options');
            }
        ));
    }
    
    /**
     * REST: Publish post to OIP
     */
    public function rest_publish_post($request) {
        $post_id = $request->get_param('id');
        $destinations = $request->get_param('destinations');
        
        $post = get_post($post_id);
        if (!$post) {
            return new WP_Error('not_found', 'Post not found', array('status' => 404));
        }
        
        // Build OIP record from WordPress post
        $record = $this->build_oip_record($post, $destinations);
        
        // Send to Onion Press Server
        $result = $this->send_to_onion_press($record, $destinations, $post_id);
        
        if (is_wp_error($result)) {
            return $result;
        }
        
        // Update post meta
        update_post_meta($post_id, 'lo_publisher_status', 'published');
        update_post_meta($post_id, 'lo_publisher_destinations', json_encode($destinations));
        
        if (!empty($result['submissionId'])) {
            update_post_meta($post_id, 'lo_publisher_submission_id', $result['submissionId']);
        }
        
        return rest_ensure_response($result);
    }
    
    /**
     * REST: Get submission status
     */
    public function rest_get_status($request) {
        $submission_id = $request->get_param('submission_id');
        
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
            'serverUrl' => $this->settings['onion_press_url'],
            'hasToken' => !empty($this->settings['api_token']),
            'defaults' => array(
                'arweave' => $this->settings['default_arweave'] ?? true,
                'gun' => $this->settings['default_gun'] ?? true,
                'internetArchive' => $this->settings['default_ia'] ?? false
            )
        ));
    }
    
    /**
     * REST: Test connection
     */
    public function rest_test_connection($request) {
        $response = wp_remote_get(
            $this->settings['onion_press_url'] . '/health',
            array(
                'timeout' => 10
            )
        );
        
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
            'server' => $body
        ));
    }
    
    /**
     * Build OIP record from WordPress post
     */
    private function build_oip_record($post, $destinations) {
        $record = array(
            'basic' => array(
                'name' => $post->post_title,
                'description' => wp_trim_words($post->post_excerpt ?: $post->post_content, 55),
                'date' => strtotime($post->post_date),
                'tagItems' => $this->get_post_tags($post->ID)
            )
        );
        
        // Add post-specific fields
        if ($post->post_type === 'post') {
            $record['post'] = array(
                'articleText' => wp_strip_all_tags($post->post_content),
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
     * Get post tags
     */
    private function get_post_tags($post_id) {
        $tags = wp_get_post_tags($post_id, array('fields' => 'names'));
        $categories = wp_get_post_categories($post_id, array('fields' => 'names'));
        return array_merge($tags, $categories);
    }
    
    /**
     * Send record to Onion Press Server
     */
    private function send_to_onion_press($record, $destinations, $post_id) {
        $body = array(
            'record' => $record,
            'destinations' => $destinations,
            'wordpress' => array(
                'postId' => $post_id,
                'postType' => get_post_type($post_id),
                'siteUrl' => get_site_url()
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
function lo_publisher_init() {
    LO_Publisher::get_instance();
}
add_action('plugins_loaded', 'lo_publisher_init');

// Activation hook
register_activation_hook(__FILE__, function() {
    // Set default options
    if (!get_option('lo_publisher_settings')) {
        add_option('lo_publisher_settings', array(
            'onion_press_url' => 'http://onion-press-service:3007',
            'api_token' => '',
            'default_arweave' => true,
            'default_gun' => true,
            'default_ia' => false,
        ));
    }
});

// Deactivation hook
register_deactivation_hook(__FILE__, function() {
    // Cleanup if needed
});

