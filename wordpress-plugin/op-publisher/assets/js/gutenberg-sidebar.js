/**
 * OP Publisher - Gutenberg Sidebar Panel
 * 
 * Adds a sidebar panel to the WordPress block editor for publishing to OIP.
 * Supports two modes:
 *   1. Mnemonic Mode: Client-side signing with user's HD wallet (login-less)
 *   2. Account Mode: Server-side signing with API token
 */

(function(wp) {
    const { registerPlugin } = wp.plugins;
    const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editPost;
    const { 
        PanelBody, Button, CheckboxControl, Spinner, Notice, 
        TextareaControl, TextControl, SelectControl, Modal,
        TabPanel, ExternalLink
    } = wp.components;
    const { useState, useEffect, useCallback } = wp.element;
    const { useSelect, useDispatch } = wp.data;
    const { Fragment } = wp.element;
    const apiFetch = wp.apiFetch;
    
    const settings = window.opPublisherSettings || {};
    const OIPCrypto = window.OIPCrypto;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN SIDEBAR COMPONENT
    // ═══════════════════════════════════════════════════════════════════════════
    
    const OPPublisherSidebar = () => {
        // State
        const [mode, setMode] = useState(settings.settings?.default_mode || 'mnemonic');
        const [mnemonic, setMnemonic] = useState('');
        const [mnemonicPassword, setMnemonicPassword] = useState('');
        const [identity, setIdentity] = useState(null);
        const [isLoadingIdentity, setIsLoadingIdentity] = useState(false);
        const [isPublishing, setIsPublishing] = useState(false);
        const [publishResult, setPublishResult] = useState(null);
        const [error, setError] = useState(null);
        const [showMnemonicModal, setShowMnemonicModal] = useState(false);
        const [showSaveModal, setShowSaveModal] = useState(false);
        const [destinations, setDestinations] = useState({
            arweave: settings.settings?.default_arweave ?? true,
            gun: settings.settings?.default_gun ?? true,
            internetArchive: settings.settings?.default_ia ?? false
        });
        
        // WordPress data
        const postId = useSelect(select => select('core/editor').getCurrentPostId());
        const postTitle = useSelect(select => select('core/editor').getEditedPostAttribute('title'));
        const postStatus = useSelect(select => select('core/editor').getEditedPostAttribute('status'));
        const meta = useSelect(select => select('core/editor').getEditedPostAttribute('meta'));
        
        const existingDID = meta?.op_publisher_did;
        const existingStatus = meta?.op_publisher_status;
        const existingMode = meta?.op_publisher_mode;
        const existingTxId = meta?.op_publisher_tx_id;
        
        // Check for stored mnemonic on mount
        useEffect(() => {
            if (OIPCrypto?.MnemonicStorage?.hasStored()) {
                // Show option to load stored mnemonic
            }
        }, []);
        
        // ═══════════════════════════════════════════════════════════════════════
        // IDENTITY HANDLING
        // ═══════════════════════════════════════════════════════════════════════
        
        /**
         * Load identity from mnemonic
         */
        const loadIdentity = useCallback(async () => {
            if (!mnemonic.trim()) {
                setError('Please enter your mnemonic phrase');
                return;
            }
            
            setIsLoadingIdentity(true);
            setError(null);
            
            try {
                const id = await OIPCrypto.OIPIdentity.fromMnemonic(mnemonic.trim());
                setIdentity(id);
                setShowMnemonicModal(false);
            } catch (err) {
                setError(err.message || 'Failed to load identity');
            } finally {
                setIsLoadingIdentity(false);
            }
        }, [mnemonic]);
        
        /**
         * Load identity from stored mnemonic
         */
        const loadStoredIdentity = async () => {
            if (!mnemonicPassword) {
                setError('Please enter your password');
                return;
            }
            
            setIsLoadingIdentity(true);
            setError(null);
            
            try {
                const storedMnemonic = await OIPCrypto.MnemonicStorage.load(mnemonicPassword);
                if (!storedMnemonic) {
                    setError('Incorrect password or no stored mnemonic');
                    return;
                }
                
                const id = await OIPCrypto.OIPIdentity.fromMnemonic(storedMnemonic);
                setIdentity(id);
                setMnemonic(storedMnemonic);
            } catch (err) {
                setError(err.message || 'Failed to load stored identity');
            } finally {
                setIsLoadingIdentity(false);
            }
        };
        
        /**
         * Save mnemonic to browser storage
         */
        const saveMnemonic = async () => {
            if (!mnemonicPassword || mnemonicPassword.length < 8) {
                setError('Password must be at least 8 characters');
                return;
            }
            
            try {
                await OIPCrypto.MnemonicStorage.save(mnemonic, mnemonicPassword);
                setShowSaveModal(false);
                setError(null);
            } catch (err) {
                setError('Failed to save mnemonic: ' + err.message);
            }
        };
        
        /**
         * Clear identity
         */
        const clearIdentity = () => {
            setIdentity(null);
            setMnemonic('');
            setMnemonicPassword('');
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // PUBLISHING
        // ═══════════════════════════════════════════════════════════════════════
        
        /**
         * Publish with mnemonic (client-side signing)
         */
        const publishMnemonicMode = async () => {
            if (!identity) {
                setError('Please load your identity first');
                return;
            }
            
            setIsPublishing(true);
            setError(null);
            setPublishResult(null);
            
            try {
                // 1. Get record structure from WordPress
                const recordResponse = await apiFetch({
                    path: `${settings.restUrl}build-record/${postId}`,
                    method: 'GET'
                });
                
                if (!recordResponse.success) {
                    throw new Error('Failed to build record');
                }
                
                // 2. Build OIP payload
                const record = recordResponse.record;
                const payload = identity.buildRecord({
                    recordType: 'post',
                    fields: {
                        0: record.basic.name,           // name
                        1: record.basic.description,    // description
                        2: record.basic.date,           // date
                        3: record.basic.tagItems,       // tagItems
                        // Post-specific fields
                        ...(record.post ? {
                            4: record.post.articleText,     // articleText (using index 4 for post template)
                            5: record.post.bylineWriter     // bylineWriter
                        } : {})
                    }
                });
                
                // 3. Sign the payload client-side
                const signedPayload = await identity.sign(payload);
                
                // 4. Submit to server for Arweave transaction
                const result = await apiFetch({
                    path: `${settings.restUrl}publish-signed`,
                    method: 'POST',
                    data: {
                        payload: signedPayload,
                        destinations,
                        postId
                    }
                });
                
                setPublishResult({
                    success: true,
                    mode: 'mnemonic',
                    ...result
                });
                
            } catch (err) {
                setError(err.message || 'Publishing failed');
            } finally {
                setIsPublishing(false);
            }
        };
        
        /**
         * Publish with account (server-side signing)
         */
        const publishAccountMode = async () => {
            setIsPublishing(true);
            setError(null);
            setPublishResult(null);
            
            try {
                const result = await apiFetch({
                    path: `${settings.restUrl}publish/${postId}`,
                    method: 'POST',
                    data: { destinations }
                });
                
                setPublishResult({
                    success: true,
                    mode: 'account',
                    ...result
                });
                
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
         * Poll for submission status (account mode)
         */
        const pollStatus = async (submissionId, attempts = 0) => {
            if (attempts >= 10) return;
            
            try {
                const status = await apiFetch({
                    path: `${settings.restUrl}status/${submissionId}`,
                    method: 'GET'
                });
                
                setPublishResult(prev => ({ ...prev, ...status }));
                
                if (status.status === 'processing' && attempts < 10) {
                    setTimeout(() => pollStatus(submissionId, attempts + 1), 3000);
                }
            } catch (err) {
                console.error('Status poll error:', err);
            }
        };
        
        /**
         * Handle publish click
         */
        const handlePublish = () => {
            if (mode === 'mnemonic') {
                publishMnemonicMode();
            } else {
                publishAccountMode();
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // RENDER
        // ═══════════════════════════════════════════════════════════════════════
        
        return (
            <Fragment>
                <PluginSidebarMoreMenuItem target="op-publisher-sidebar">
                    🧅 Publish to OIP
                </PluginSidebarMoreMenuItem>
                
                <PluginSidebar
                    name="op-publisher-sidebar"
                    title="🧅 OP Publisher"
                    icon="share-alt"
                >
                    {/* Mode Selection */}
                    <PanelBody title="Publishing Mode" initialOpen={true}>
                        <div className="op-mode-tabs">
                            <TabPanel
                                className="op-mode-tab-panel"
                                activeClass="is-active"
                                initialTabName={mode}
                                onSelect={(tabName) => setMode(tabName)}
                                tabs={[
                                    {
                                        name: 'mnemonic',
                                        title: '🔑 Mnemonic',
                                        className: 'op-tab-mnemonic'
                                    },
                                    {
                                        name: 'account',
                                        title: '👤 Account',
                                        className: 'op-tab-account'
                                    }
                                ]}
                            >
                                {(tab) => (
                                    <div className="op-tab-content">
                                        {tab.name === 'mnemonic' && (
                                            <MnemonicModePanel
                                                identity={identity}
                                                isLoadingIdentity={isLoadingIdentity}
                                                onLoadClick={() => setShowMnemonicModal(true)}
                                                onClearClick={clearIdentity}
                                                hasStoredMnemonic={OIPCrypto?.MnemonicStorage?.hasStored()}
                                                onLoadStoredClick={() => setShowMnemonicModal(true)}
                                                rememberEnabled={settings.settings?.remember_mnemonic}
                                            />
                                        )}
                                        {tab.name === 'account' && (
                                            <AccountModePanel
                                                hasToken={settings.settings?.api_token}
                                            />
                                        )}
                                    </div>
                                )}
                            </TabPanel>
                        </div>
                    </PanelBody>
                    
                    {/* Destinations */}
                    <PanelBody title="📤 Destinations" initialOpen={true}>
                        <CheckboxControl
                            label="⛓️ Arweave"
                            help="Permanent blockchain storage"
                            checked={destinations.arweave}
                            onChange={(value) => setDestinations({...destinations, arweave: value})}
                        />
                        <CheckboxControl
                            label="🔄 GUN"
                            help="Real-time peer sync"
                            checked={destinations.gun}
                            onChange={(value) => setDestinations({...destinations, gun: value})}
                        />
                        <CheckboxControl
                            label="🧅 Internet Archive"
                            help="Anonymous via TOR"
                            checked={destinations.internetArchive}
                            onChange={(value) => setDestinations({...destinations, internetArchive: value})}
                        />
                    </PanelBody>
                    
                    {/* Publish Action */}
                    <PanelBody title="🚀 Publish" initialOpen={true}>
                        {postStatus !== 'publish' && (
                            <Notice status="warning" isDismissible={false}>
                                Post must be published in WordPress first
                            </Notice>
                        )}
                        
                        {mode === 'mnemonic' && !identity && (
                            <Notice status="info" isDismissible={false}>
                                Load your identity to enable publishing
                            </Notice>
                        )}
                        
                        {mode === 'account' && !settings.settings?.api_token && (
                            <Notice status="warning" isDismissible={false}>
                                Configure API token in plugin settings
                            </Notice>
                        )}
                        
                        <Button
                            isPrimary
                            onClick={handlePublish}
                            disabled={
                                isPublishing || 
                                postStatus !== 'publish' ||
                                (mode === 'mnemonic' && !identity) ||
                                (mode === 'account' && !settings.settings?.api_token)
                            }
                            style={{ width: '100%', justifyContent: 'center', marginTop: '12px' }}
                        >
                            {isPublishing ? (
                                <Fragment>
                                    <Spinner /> Publishing...
                                </Fragment>
                            ) : (
                                `📤 Publish to OIP (${mode === 'mnemonic' ? 'Client Signed' : 'Server Signed'})`
                            )}
                        </Button>
                        
                        {/* Error Display */}
                        {error && (
                            <Notice status="error" isDismissible={true} onRemove={() => setError(null)} style={{ marginTop: '12px' }}>
                                {error}
                            </Notice>
                        )}
                        
                        {/* Success/Result Display */}
                        {publishResult && (
                            <PublishResultPanel result={publishResult} />
                        )}
                    </PanelBody>
                    
                    {/* Previous Publication */}
                    {existingDID && (
                        <PanelBody title="📋 Previous Publication" initialOpen={false}>
                            <div style={{ fontSize: '12px' }}>
                                <div style={{ marginBottom: '8px' }}>
                                    <strong>Mode:</strong> {existingMode === 'mnemonic' ? '🔑 Mnemonic' : '👤 Account'}
                                </div>
                                {existingTxId && (
                                    <div style={{ marginBottom: '8px' }}>
                                        <strong>Transaction:</strong>
                                        <div style={{ wordBreak: 'break-all', color: '#666', fontFamily: 'monospace', fontSize: '10px' }}>
                                            <ExternalLink href={`https://viewblock.io/arweave/tx/${existingTxId}`}>
                                                {existingTxId.substring(0, 20)}...
                                            </ExternalLink>
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <strong>DID:</strong>
                                    <div style={{ wordBreak: 'break-all', color: '#666', fontFamily: 'monospace', fontSize: '10px' }}>
                                        {existingDID}
                                    </div>
                                </div>
                            </div>
                        </PanelBody>
                    )}
                    
                    {/* About */}
                    <PanelBody title="ℹ️ About" initialOpen={false}>
                        <p style={{ fontSize: '12px', color: '#666' }}>
                            <strong>OP Publisher v{settings.version}</strong> connects WordPress to the 
                            Open Index Protocol (OIP), enabling permanent decentralized publishing.
                        </p>
                        <p style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>
                            <strong>Mnemonic Mode:</strong> Your identity stays private. Signing happens in your browser.
                        </p>
                        <p style={{ fontSize: '11px', color: '#999' }}>
                            <strong>Account Mode:</strong> Server signs on behalf of the publication.
                        </p>
                    </PanelBody>
                </PluginSidebar>
                
                {/* Mnemonic Input Modal */}
                {showMnemonicModal && (
                    <MnemonicModal
                        mnemonic={mnemonic}
                        setMnemonic={setMnemonic}
                        mnemonicPassword={mnemonicPassword}
                        setMnemonicPassword={setMnemonicPassword}
                        hasStoredMnemonic={OIPCrypto?.MnemonicStorage?.hasStored()}
                        isLoading={isLoadingIdentity}
                        error={error}
                        onLoadNew={loadIdentity}
                        onLoadStored={loadStoredIdentity}
                        onClose={() => {
                            setShowMnemonicModal(false);
                            setError(null);
                        }}
                        rememberEnabled={settings.settings?.remember_mnemonic}
                        onSaveClick={() => setShowSaveModal(true)}
                        identity={identity}
                    />
                )}
                
                {/* Save Mnemonic Modal */}
                {showSaveModal && (
                    <Modal
                        title="💾 Save Mnemonic"
                        onRequestClose={() => setShowSaveModal(false)}
                    >
                        <p style={{ marginBottom: '16px' }}>
                            Your mnemonic will be encrypted with your password and stored in browser storage.
                        </p>
                        <Notice status="warning" isDismissible={false} style={{ marginBottom: '16px' }}>
                            ⚠️ Browser storage is not as secure as hardware wallets. Only use this for non-critical identities.
                        </Notice>
                        <TextControl
                            label="Encryption Password"
                            type="password"
                            value={mnemonicPassword}
                            onChange={setMnemonicPassword}
                            help="Minimum 8 characters. You'll need this to unlock your mnemonic."
                        />
                        {error && (
                            <Notice status="error" isDismissible={false}>
                                {error}
                            </Notice>
                        )}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                            <Button isPrimary onClick={saveMnemonic}>
                                Save Encrypted
                            </Button>
                            <Button isSecondary onClick={() => setShowSaveModal(false)}>
                                Cancel
                            </Button>
                        </div>
                    </Modal>
                )}
            </Fragment>
        );
    };
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SUB-COMPONENTS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Mnemonic Mode Panel
     */
    const MnemonicModePanel = ({ identity, isLoadingIdentity, onLoadClick, onClearClick, hasStoredMnemonic, rememberEnabled }) => {
        if (identity) {
            return (
                <div className="op-identity-loaded">
                    <div style={{ 
                        background: '#f0fdf4', 
                        border: '1px solid #22c55e', 
                        borderRadius: '8px', 
                        padding: '12px',
                        marginBottom: '12px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '20px', marginRight: '8px' }}>✅</span>
                            <strong>Identity Loaded</strong>
                        </div>
                        <div style={{ fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all', color: '#166534' }}>
                            {identity.did}
                        </div>
                    </div>
                    <Button isDestructive isSmall onClick={onClearClick}>
                        Clear Identity
                    </Button>
                </div>
            );
        }
        
        return (
            <div className="op-identity-prompt">
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                    Enter your 24-word mnemonic phrase to sign records with your identity.
                    <strong> Your mnemonic never leaves your browser.</strong>
                </p>
                <Button isPrimary onClick={onLoadClick} disabled={isLoadingIdentity}>
                    {isLoadingIdentity ? <Spinner /> : '🔑 Load Identity'}
                </Button>
                {hasStoredMnemonic && rememberEnabled && (
                    <Button isSecondary onClick={onLoadClick} style={{ marginLeft: '8px' }}>
                        🔓 Unlock Saved
                    </Button>
                )}
            </div>
        );
    };
    
    /**
     * Account Mode Panel
     */
    const AccountModePanel = ({ hasToken }) => {
        return (
            <div className="op-account-info">
                <p style={{ fontSize: '12px', color: '#666', marginBottom: '12px' }}>
                    Records will be signed by the server using the configured API token.
                    All posts share the publication's identity.
                </p>
                {hasToken ? (
                    <div style={{ 
                        background: '#f0fdf4', 
                        border: '1px solid #22c55e', 
                        borderRadius: '8px', 
                        padding: '12px'
                    }}>
                        <span style={{ fontSize: '20px', marginRight: '8px' }}>✅</span>
                        <strong>API Token Configured</strong>
                    </div>
                ) : (
                    <div style={{ 
                        background: '#fef2f2', 
                        border: '1px solid #ef4444', 
                        borderRadius: '8px', 
                        padding: '12px'
                    }}>
                        <span style={{ fontSize: '20px', marginRight: '8px' }}>❌</span>
                        <strong>No API Token</strong>
                        <p style={{ fontSize: '11px', marginTop: '4px' }}>
                            Configure in Settings → OP Publisher
                        </p>
                    </div>
                )}
            </div>
        );
    };
    
    /**
     * Mnemonic Input Modal
     */
    const MnemonicModal = ({ 
        mnemonic, setMnemonic, 
        mnemonicPassword, setMnemonicPassword,
        hasStoredMnemonic, isLoading, error,
        onLoadNew, onLoadStored, onClose,
        rememberEnabled, onSaveClick, identity
    }) => {
        const [showNew, setShowNew] = useState(!hasStoredMnemonic);
        
        return (
            <Modal
                title="🔑 Load Identity"
                onRequestClose={onClose}
                className="op-mnemonic-modal"
            >
                {hasStoredMnemonic && rememberEnabled && (
                    <div style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                            <Button 
                                isSecondary={showNew} 
                                isPrimary={!showNew}
                                onClick={() => setShowNew(false)}
                            >
                                🔓 Unlock Saved
                            </Button>
                            <Button 
                                isSecondary={!showNew} 
                                isPrimary={showNew}
                                onClick={() => setShowNew(true)}
                            >
                                ✏️ Enter New
                            </Button>
                        </div>
                    </div>
                )}
                
                {!showNew && hasStoredMnemonic ? (
                    <div>
                        <TextControl
                            label="Password"
                            type="password"
                            value={mnemonicPassword}
                            onChange={setMnemonicPassword}
                            placeholder="Enter your password"
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                            <Button isPrimary onClick={onLoadStored} disabled={isLoading}>
                                {isLoading ? <Spinner /> : 'Unlock'}
                            </Button>
                            <Button 
                                isDestructive 
                                onClick={() => {
                                    OIPCrypto.MnemonicStorage.clear();
                                    setShowNew(true);
                                }}
                            >
                                Forget Saved
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div>
                        <TextareaControl
                            label="Mnemonic Phrase"
                            value={mnemonic}
                            onChange={setMnemonic}
                            placeholder="Enter your 24-word mnemonic phrase..."
                            rows={4}
                            style={{ fontFamily: 'monospace' }}
                        />
                        <p style={{ fontSize: '11px', color: '#666', marginTop: '-8px', marginBottom: '16px' }}>
                            🔒 Your mnemonic is processed locally and never sent to any server.
                        </p>
                        
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <Button isPrimary onClick={onLoadNew} disabled={isLoading || !mnemonic.trim()}>
                                {isLoading ? <Spinner /> : 'Load Identity'}
                            </Button>
                            {identity && rememberEnabled && (
                                <Button isSecondary onClick={onSaveClick}>
                                    💾 Save for Later
                                </Button>
                            )}
                        </div>
                    </div>
                )}
                
                {error && (
                    <Notice status="error" isDismissible={false} style={{ marginTop: '16px' }}>
                        {error}
                    </Notice>
                )}
                
                {identity && (
                    <div style={{ 
                        marginTop: '16px',
                        padding: '12px',
                        background: '#f0fdf4',
                        borderRadius: '8px',
                        border: '1px solid #22c55e'
                    }}>
                        <strong>✅ Identity Loaded</strong>
                        <div style={{ fontSize: '10px', fontFamily: 'monospace', marginTop: '4px', wordBreak: 'break-all' }}>
                            {identity.did}
                        </div>
                        <Button isSmall isPrimary onClick={onClose} style={{ marginTop: '8px' }}>
                            Continue
                        </Button>
                    </div>
                )}
            </Modal>
        );
    };
    
    /**
     * Publish Result Panel
     */
    const PublishResultPanel = ({ result }) => {
        const isSuccess = result.success || result.transactionId;
        
        return (
            <div style={{ 
                marginTop: '12px', 
                padding: '12px', 
                background: isSuccess ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${isSuccess ? '#22c55e' : '#ef4444'}`,
                borderRadius: '8px' 
            }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '20px', marginRight: '8px' }}>
                        {isSuccess ? '✅' : '❌'}
                    </span>
                    <strong>{isSuccess ? 'Published!' : 'Failed'}</strong>
                    {result.mode && (
                        <span style={{ 
                            marginLeft: '8px', 
                            fontSize: '10px', 
                            background: result.mode === 'mnemonic' ? '#8b5cf6' : '#3b82f6',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '4px'
                        }}>
                            {result.mode === 'mnemonic' ? '🔑 Client Signed' : '👤 Server Signed'}
                        </span>
                    )}
                </div>
                
                {result.transactionId && (
                    <div style={{ marginBottom: '8px' }}>
                        <strong style={{ fontSize: '11px' }}>Transaction ID:</strong>
                        <div style={{ fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            <ExternalLink href={`https://viewblock.io/arweave/tx/${result.transactionId}`}>
                                {result.transactionId}
                            </ExternalLink>
                        </div>
                    </div>
                )}
                
                {result.did && (
                    <div style={{ marginBottom: '8px' }}>
                        <strong style={{ fontSize: '11px' }}>Record DID:</strong>
                        <div style={{ fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all', color: '#666' }}>
                            {result.did}
                        </div>
                    </div>
                )}
                
                {result.creator && (
                    <div>
                        <strong style={{ fontSize: '11px' }}>Creator:</strong>
                        <div style={{ fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all', color: '#666' }}>
                            {result.creator}
                        </div>
                    </div>
                )}
                
                {result.results && (
                    <div style={{ marginTop: '8px', fontSize: '11px' }}>
                        <strong>Destinations:</strong>
                        {Object.entries(result.results).map(([dest, destResult]) => (
                            <div key={dest} style={{ marginTop: '4px', display: 'flex', alignItems: 'center' }}>
                                <span style={{ 
                                    color: destResult.status === 'success' ? '#22c55e' : 
                                           destResult.status === 'error' ? '#ef4444' : '#9ca3af'
                                }}>
                                    {destResult.status === 'success' ? '✓' : 
                                     destResult.status === 'error' ? '✗' : '○'}
                                </span>
                                <span style={{ marginLeft: '6px' }}>{dest}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };
    
    // Register the plugin
    registerPlugin('op-publisher', {
        render: OPPublisherSidebar,
        icon: 'share-alt'
    });
    
})(window.wp);
