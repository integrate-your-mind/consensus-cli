import React from 'react';
import { toast } from 'sonner';

export const VariationNine: React.FC = () => {
    const handleInstallClick = () => {
        navigator.clipboard.writeText('npm install @consensus/sdk');
        toast.success('Install command copied to clipboard!');
        console.log('Track: cta_install_click');
    };

    const handleCloudClick = () => {
        toast.info('Cloud Access requested!');
        console.log('Track: cta_cloud_click');
    };

    const containerStyle: React.CSSProperties = {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    };

    const cardStyle: React.CSSProperties = {
        background: 'var(--bg-accent)',
        padding: '48px 64px',
        borderRadius: '8px',
        border: '2px dashed var(--muted)',
        maxWidth: '500px',
        textAlign: 'center',
        color: 'var(--text)',
        fontFamily: '"IBM Plex Mono", monospace',
        position: 'relative',
    };

    const titleStyle: React.CSSProperties = {
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: '28px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        marginBottom: '12px',
        color: 'var(--text)',
        borderBottom: '2px dashed var(--muted)',
        display: 'inline-block',
        paddingBottom: '8px',
    };

    const subtitleStyle: React.CSSProperties = {
        fontSize: '13px',
        color: 'var(--muted)',
        marginBottom: '32px',
        lineHeight: '1.6',
        fontStyle: 'italic',
    };

    const primaryBtnStyle: React.CSSProperties = {
        background: 'transparent',
        color: 'var(--active)',
        border: '1px dashed var(--active)',
        padding: '12px 24px',
        borderRadius: '4px',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        letterSpacing: '0.05em',
        marginRight: '16px',
        transition: 'all 0.2s',
    };

    const secondaryBtnStyle: React.CSSProperties = {
        background: 'transparent',
        color: 'var(--muted)',
        border: '1px dashed var(--muted)',
        padding: '12px 24px',
        borderRadius: '4px',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        letterSpacing: '0.05em',
    };

    return (
        <main id="main" style={containerStyle}>
            <div style={cardStyle}>
                <div style={{
                    position: 'absolute',
                    top: '-12px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--bg)',
                    padding: '0 12px',
                    color: 'var(--muted)',
                    fontSize: '10px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.2em'
                }}>
                    Prototype
                </div>
                <h1 style={titleStyle}>Draft Mode</h1>
                <p style={subtitleStyle}>
          // TODO: Implement infrastructure<br />
                    Architect your future with Consensus.
                </p>

                <div>
                    <button
                        onClick={handleInstallClick}
                        style={primaryBtnStyle}
                        className="cta-install"
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(81, 195, 165, 0.1)';
                            e.currentTarget.style.borderStyle = 'solid';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderStyle = 'dashed';
                        }}
                    >
                        INSTALL SDK
                    </button>

                    <button
                        onClick={handleCloudClick}
                        style={secondaryBtnStyle}
                        className="cta-secondary"
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = 'var(--text)';
                            e.currentTarget.style.borderColor = 'var(--text)';
                            e.currentTarget.style.borderStyle = 'solid';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = 'var(--muted)';
                            e.currentTarget.style.borderColor = 'var(--muted)';
                            e.currentTarget.style.borderStyle = 'dashed';
                        }}
                    >
                        CLOUD ACCESS
                    </button>
                </div>
            </div>
        </main>
    );
};
