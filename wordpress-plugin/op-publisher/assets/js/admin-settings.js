/**
 * OP Publisher - Admin Settings Page Scripts
 */

(function($) {
    'use strict';
    
    const config = window.opPublisher || {};
    
    $(document).ready(function() {
        
        // Test Onion Press Connection
        $('#op-test-onion-press').on('click', function() {
            const $btn = $(this);
            const $result = $('#op-test-result');
            
            $btn.prop('disabled', true).text('Testing...');
            $result.html('<span style="color: #666;">Connecting to Onion Press...</span>');
            
            $.ajax({
                url: config.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'op_test_connection',
                    service: 'onion-press',
                    nonce: config.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $result.html('<span style="color: green;">✅ Onion Press connected!</span>');
                    } else {
                        $result.html('<span style="color: red;">❌ ' + (response.data || 'Connection failed') + '</span>');
                    }
                },
                error: function(xhr, status, error) {
                    $result.html('<span style="color: red;">❌ ' + error + '</span>');
                },
                complete: function() {
                    $btn.prop('disabled', false).text('Test Onion Press');
                }
            });
        });
        
        // Test OIP Daemon Connection
        $('#op-test-oip-daemon').on('click', function() {
            const $btn = $(this);
            const $result = $('#op-test-result');
            
            $btn.prop('disabled', true).text('Testing...');
            $result.html('<span style="color: #666;">Connecting to OIP Daemon...</span>');
            
            $.ajax({
                url: config.ajaxUrl,
                method: 'POST',
                data: {
                    action: 'op_test_connection',
                    service: 'oip-daemon',
                    nonce: config.nonce
                },
                success: function(response) {
                    if (response.success) {
                        $result.html('<span style="color: green;">✅ OIP Daemon connected!</span>');
                    } else {
                        $result.html('<span style="color: red;">❌ ' + (response.data || 'Connection failed') + '</span>');
                    }
                },
                error: function(xhr, status, error) {
                    $result.html('<span style="color: red;">❌ ' + error + '</span>');
                },
                complete: function() {
                    $btn.prop('disabled', false).text('Test OIP Daemon');
                }
            });
        });
        
        // Alternative: Direct fetch test (if AJAX handler not available)
        $('#op-test-onion-press').on('click', function(e) {
            if (!config.ajaxUrl) {
                e.stopImmediatePropagation();
                const $btn = $(this);
                const $result = $('#op-test-result');
                const url = $('input[name="op_publisher_settings[onion_press_url]"]').val();
                
                $btn.prop('disabled', true).text('Testing...');
                $result.html('<span style="color: #666;">Connecting...</span>');
                
                fetch(url + '/health', { method: 'GET', mode: 'cors' })
                    .then(response => response.json())
                    .then(data => {
                        $result.html('<span style="color: green;">✅ Connected! Status: ' + data.status + '</span>');
                    })
                    .catch(error => {
                        $result.html('<span style="color: red;">❌ ' + error.message + '</span>');
                    })
                    .finally(() => {
                        $btn.prop('disabled', false).text('Test Onion Press');
                    });
            }
        });
        
        $('#op-test-oip-daemon').on('click', function(e) {
            if (!config.ajaxUrl) {
                e.stopImmediatePropagation();
                const $btn = $(this);
                const $result = $('#op-test-result');
                const url = $('input[name="op_publisher_settings[oip_daemon_url]"]').val();
                
                $btn.prop('disabled', true).text('Testing...');
                $result.html('<span style="color: #666;">Connecting...</span>');
                
                fetch(url + '/health', { method: 'GET', mode: 'cors' })
                    .then(response => response.json())
                    .then(data => {
                        $result.html('<span style="color: green;">✅ Connected! Status: ' + data.status + '</span>');
                    })
                    .catch(error => {
                        $result.html('<span style="color: red;">❌ ' + error.message + '</span>');
                    })
                    .finally(() => {
                        $btn.prop('disabled', false).text('Test OIP Daemon');
                    });
            }
        });
        
        // Mode option visual selection
        $('.mode-option').on('click', function() {
            $('.mode-option').removeClass('selected');
            $(this).addClass('selected');
            $(this).find('input[type="radio"]').prop('checked', true);
        });
        
    });
    
})(jQuery);
