/**
 * LO Publisher - Admin Settings JavaScript
 */

jQuery(document).ready(function($) {
    
    // Test connection button
    $('#lo-test-connection').on('click', function() {
        var $button = $(this);
        var $result = $('#lo-test-result');
        
        $button.prop('disabled', true).text('Testing...');
        $result.html('');
        
        $.ajax({
            url: loPublisher.ajaxUrl,
            type: 'GET',
            data: {
                action: 'lo_publisher_test_connection',
                nonce: loPublisher.nonce
            },
            success: function(response) {
                if (response.success) {
                    $result.html('<span style="color: green;">✓ Connection successful! Server: ' + 
                                 (response.data.server?.service || 'Unknown') + '</span>');
                } else {
                    $result.html('<span style="color: red;">✗ Connection failed: ' + 
                                 (response.data || 'Unknown error') + '</span>');
                }
            },
            error: function(xhr, status, error) {
                $result.html('<span style="color: red;">✗ Connection failed: ' + error + '</span>');
            },
            complete: function() {
                $button.prop('disabled', false).text('Test Connection');
            }
        });
    });
    
    // Direct fetch test (bypassing WordPress AJAX)
    $('#lo-test-connection').on('dblclick', function() {
        var serverUrl = $('input[name="lo_publisher_settings[onion_press_url]"]').val();
        var $result = $('#lo-test-result');
        
        $result.html('Direct test to: ' + serverUrl + '/health ...');
        
        fetch(serverUrl + '/health')
            .then(response => response.json())
            .then(data => {
                $result.html('<span style="color: green;">✓ Direct connection OK: ' + 
                             JSON.stringify(data) + '</span>');
            })
            .catch(error => {
                $result.html('<span style="color: orange;">⚠ Direct connection failed (may be CORS): ' + 
                             error.message + '</span>');
            });
    });
    
});

