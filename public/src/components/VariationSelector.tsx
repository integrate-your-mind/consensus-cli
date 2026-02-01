/// <reference types="vite/client" />
import React from 'react';

interface VariationSelectorProps {
    currentVariation: string;
    onSelect: (variation: string) => void;
}

export const VariationSelector: React.FC<VariationSelectorProps> = ({ currentVariation, onSelect }) => {
    if (!import.meta.env.DEV) {
        return null;
    }

    const containerStyle: React.CSSProperties = {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        padding: '16px',
        background: 'var(--glass)',
        border: '1px solid rgba(87, 242, 198, 0.2)',
        borderRadius: '14px',
        backdropFilter: 'blur(10px)',
        zIndex: 9999,
        color: 'var(--text)',
        fontFamily: '"IBM Plex Mono", monospace',
        boxShadow: '0 18px 40px rgba(0, 0, 0, 0.35)',
        minWidth: '200px',
    };

    const titleStyle: React.CSSProperties = {
        fontFamily: '"Chakra Petch", sans-serif',
        fontWeight: 700,
        fontSize: '12px',
        letterSpacing: '0.05em',
        color: 'var(--muted)',
        textTransform: 'uppercase',
        marginBottom: '12px',
    };

    const optionStyle: React.CSSProperties = {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '8px',
        cursor: 'pointer',
        fontSize: '13px',
    };

    const inputStyle: React.CSSProperties = {
        accentColor: 'var(--accent)',
        cursor: 'pointer',
    };

    return (
        <div style={containerStyle}>
            <div style={titleStyle}>Dev: Select Variation</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={optionStyle}>
                    <input
                        type="radio"
                        name="variation"
                        value="control"
                        checked={currentVariation === 'control'}
                        onChange={(e) => onSelect(e.target.value)}
                        style={inputStyle}
                    />
                    <span>Control</span>
                </label>
                <label style={optionStyle}>
                    <input
                        type="radio"
                        name="variation"
                        value="liquid"
                        checked={currentVariation === 'liquid'}
                        onChange={(e) => onSelect(e.target.value)}
                        style={inputStyle}
                    />
                    <span>Liquid (V8)</span>
                </label>
                <label style={optionStyle}>
                    <input
                        type="radio"
                        name="variation"
                        value="sketch"
                        checked={currentVariation === 'sketch'}
                        onChange={(e) => onSelect(e.target.value)}
                        style={inputStyle}
                    />
                    <span>Sketch (V9)</span>
                </label>
            </div>
        </div>
    );
};
