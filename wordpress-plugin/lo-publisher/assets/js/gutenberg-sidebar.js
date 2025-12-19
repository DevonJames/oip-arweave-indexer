/**
 * LO Publisher - Gutenberg Sidebar Panel
 * 
 * Adds a sidebar panel to the WordPress block editor for publishing to OIP
 */

(function(wp) {
    const { registerPlugin } = wp.plugins;
    const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editPost;
    const { PanelBody, Button, CheckboxControl, Spinner, Notice } = wp.components;
    const { useState, useEffect } = wp.element;
    const { useSelect, useDispatch } = wp.data;
    const { Fragment } = wp.element;
    const apiFetch = wp.apiFetch;
    
    const settings = window.loPublisherSettings || {};
    
    /**
     * LO Publisher Sidebar Component
     */
    const LOPublisherSidebar = () => {
        const [isPublishing, setIsPublishing] = useState(false);
        const [publishResult, setPublishResult] = useState(null);
        const [error, setError] = useState(null);
        const [destinations, setDestinations] = useState({
            arweave: settings.settings?.default_arweave ?? true,
            gun: settings.settings?.default_gun ?? true,
            internetArchive: settings.settings?.default_ia ?? false
        });
        
        const postId = useSelect(select => select('core/editor').getCurrentPostId());
        const postTitle = useSelect(select => select('core/editor').getEditedPostAttribute('title'));
        const postStatus = useSelect(select => select('core/editor').getEditedPostAttribute('status'));
        const meta = useSelect(select => select('core/editor').getEditedPostAttribute('meta'));
        
        const existingDID = meta?.lo_publisher_did;
        const existingStatus = meta?.lo_publisher_status;
        
        /**
         * Publish to OIP
         */
        const handlePublish = async () => {
            setIsPublishing(true);
            setError(null);
            setPublishResult(null);
            
            try {
                const result = await apiFetch({
                    path: `${settings.restUrl}publish/${postId}`,
                    method: 'POST',
                    data: { destinations }
                });
                
                setPublishResult(result);
                
                // Poll for status if we got a submission ID
                if (result.submissionId) {
                    pollStatus(result.submissionId);
                }
                
            } catch (err) {
                setError(err.message || 'Publishing failed');
            } finally {
                setIsPublishing(false);
            }
        };
        
        /**
         * Poll for submission status
         */
        const pollStatus = async (submissionId, attempts = 0) => {
            if (attempts >= 10) return; // Max 10 attempts
            
            try {
                const status = await apiFetch({
                    path: `${settings.restUrl}status/${submissionId}`,
                    method: 'GET'
                });
                
                setPublishResult(status);
                
                if (status.status === 'processing' && attempts < 10) {
                    setTimeout(() => pollStatus(submissionId, attempts + 1), 3000);
                }
            } catch (err) {
                console.error('Status poll error:', err);
            }
        };
        
        return (
            <Fragment>
                <PluginSidebarMoreMenuItem target="lo-publisher-sidebar">
                    🧅 Publish to OIP
                </PluginSidebarMoreMenuItem>
                
                <PluginSidebar
                    name="lo-publisher-sidebar"
                    title="🧅 LO Publisher"
                    icon="share-alt"
                >
                    <PanelBody title="Publishing Destinations" initialOpen={true}>
                        <p style={{ color: '#666', marginBottom: '16px' }}>
                            Select where to publish this content:
                        </p>
                        
                        <CheckboxControl
                            label="⛓️ Arweave"
                            help="Permanent blockchain storage"
                            checked={destinations.arweave}
                            onChange={(value) => setDestinations({...destinations, arweave: value})}
                        />
                        
                        <CheckboxControl
                            label="🔄 GUN"
                            help="Real-time peer synchronization"
                            checked={destinations.gun}
                            onChange={(value) => setDestinations({...destinations, gun: value})}
                        />
                        
                        <CheckboxControl
                            label="🧅 Internet Archive (TOR)"
                            help="Anonymous submission via TOR"
                            checked={destinations.internetArchive}
                            onChange={(value) => setDestinations({...destinations, internetArchive: value})}
                        />
                    </PanelBody>
                    
                    <PanelBody title="Publish" initialOpen={true}>
                        {postStatus !== 'publish' && (
                            <Notice status="warning" isDismissible={false}>
                                Post must be published in WordPress first
                            </Notice>
                        )}
                        
                        <Button
                            isPrimary
                            onClick={handlePublish}
                            disabled={isPublishing || postStatus !== 'publish'}
                            style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
                        >
                            {isPublishing ? (
                                <Fragment>
                                    <Spinner /> Publishing...
                                </Fragment>
                            ) : (
                                '📤 Publish to OIP'
                            )}
                        </Button>
                        
                        {error && (
                            <Notice status="error" isDismissible={false} style={{ marginTop: '12px' }}>
                                {error}
                            </Notice>
                        )}
                        
                        {publishResult && (
                            <div style={{ marginTop: '12px', padding: '12px', background: '#f0f0f0', borderRadius: '4px' }}>
                                <strong>Status:</strong> {publishResult.status}
                                
                                {publishResult.results && (
                                    <div style={{ marginTop: '8px', fontSize: '12px' }}>
                                        {Object.entries(publishResult.results).map(([dest, result]) => (
                                            <div key={dest} style={{ marginTop: '4px' }}>
                                                <span>{dest}: </span>
                                                <span style={{ 
                                                    color: result.status === 'success' ? 'green' : 
                                                           result.status === 'error' ? 'red' : 'gray' 
                                                }}>
                                                    {result.status}
                                                </span>
                                                {result.did && (
                                                    <div style={{ fontSize: '10px', color: '#666', wordBreak: 'break-all' }}>
                                                        DID: {result.did}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </PanelBody>
                    
                    {existingDID && (
                        <PanelBody title="Previous Publication" initialOpen={false}>
                            <div style={{ fontSize: '12px' }}>
                                <strong>DID:</strong>
                                <div style={{ wordBreak: 'break-all', color: '#666' }}>
                                    {existingDID}
                                </div>
                            </div>
                        </PanelBody>
                    )}
                    
                    <PanelBody title="About" initialOpen={false}>
                        <p style={{ fontSize: '12px', color: '#666' }}>
                            LO Publisher connects WordPress to the Open Index Protocol (OIP),
                            enabling permanent, decentralized publishing to Arweave, GUN, and
                            anonymous submission to the Internet Archive via TOR.
                        </p>
                        <p style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>
                            Server: {settings.settings?.onion_press_url || 'Not configured'}
                        </p>
                    </PanelBody>
                </PluginSidebar>
            </Fragment>
        );
    };
    
    // Register the plugin
    registerPlugin('lo-publisher', {
        render: LOPublisherSidebar,
        icon: 'share-alt'
    });
    
})(window.wp);

