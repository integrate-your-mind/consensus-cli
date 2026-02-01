import React from 'react';
import { toast } from 'sonner';

export const VariationEight: React.FC = () => {
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
        // Inherits #main background grid from style.css
    };

    const cardStyle: React.CSSProperties = {
        background: 'var(--glass)',
        padding: '48px 64px',
        borderRadius: '24px',
        border: '1px solid var(--accent)',
        boxShadow: '0 0 40px rgba(87, 242, 198, 0.15)',
        backdropFilter: 'blur(12px)',
        maxWidth: '500px',
        textAlign: 'center',
        color: 'var(--text)',
        fontFamily: '"IBM Plex Mono", monospace',
    };

    const titleStyle: React.CSSProperties = {
        fontFamily: '"Chakra Petch", sans-serif',
        fontSize: '32px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '8px',
        background: 'linear-gradient(120deg, var(--text), var(--accent))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
    };

    const subtitleStyle: React.CSSProperties = {
        fontSize: '14px',
        color: 'var(--muted)',
        marginBottom: '32px',
        lineHeight: '1.6',
    };

    const primaryBtnStyle: React.CSSProperties = {
        background: 'var(--accent)',
        color: '#0f1216',
        border: 'none',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        letterSpacing: '0.05em',
        marginRight: '16px',
        transition: 'transform 0.2s',
    };

    const secondaryBtnStyle: React.CSSProperties = {
        background: 'transparent',
        color: 'var(--accent)',
        border: '1px solid var(--accent)',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        letterSpacing: '0.05em',
    };

    return (
        <main id="main" style={containerStyle}>
            <div style={cardStyle}>
                <h1 style={titleStyle}>Liquid Mode</h1>
                <p style={subtitleStyle}>
                    Seamless integration. Fluid scaling.<br />
                    Optimize your agent fleet with the new runtime.
                </p>

                <div>
                    <button
                        onClick={handleInstallClick}
                        style={primaryBtnStyle}
                        className="cta-install"
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        INSTALL SDK
                    </button>

                    <button
                        onClick={handleCloudClick}
                        style={secondaryBtnStyle}
                        className="cta-secondary"
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(87, 242, 198, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        CLOUD ACCESS
                    </button>
                </div>
            </div>
        </main>
    );
};
