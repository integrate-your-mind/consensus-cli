/// <reference types="vite/client" />
import { useEffect, useState } from 'react';
import { GrowthBook, GrowthBookProvider, useFeature } from '@growthbook/growthbook-react';
import { Toaster } from 'sonner';
import { CanvasApp } from './CanvasApp';
import { VariationEight, VariationNine } from './variations';
import { VariationSelector } from './components/VariationSelector';

// Initialize GrowthBook instance
const growthbook = new GrowthBook({
    apiHost: import.meta.env.VITE_GROWTHBOOK_API_HOST || "https://cdn.growthbook.io",
    clientKey: import.meta.env.VITE_GROWTHBOOK_CLIENT_KEY || "sdk-key",
    enableDevMode: import.meta.env.DEV,
    trackingCallback: (experiment, result) => {
        // TODO: Implement tracking
        console.log("Experiment Viewed:", {
            experimentId: experiment.key,
            variationId: result.key,
        });
    },
});

function AppContent() {
    const landingDesign = useFeature("landing_design_v1");
    // Default to control (CanvasApp) if flag is off or not 'liquid'/'sketch'
    // But strictly, if flag is missing, we might want control.
    // The feature value should match the variation keys.

    const [devOverride, setDevOverride] = useState<string | null>(null);

    const variation = devOverride || landingDesign.value || 'control';

    // In a real edge-assigned setup with hydration, content might be ready immediately.
    // Here we rely on the SDK.

    return (
        <>
            {variation === 'liquid' && <VariationEight />}
            {variation === 'sketch' && <VariationNine />}
            {variation === 'control' && <CanvasApp />}

            {/* Fallback if something unexpected happens */}
            {variation !== 'liquid' && variation !== 'sketch' && variation !== 'control' && <CanvasApp />}

            <VariationSelector
                currentVariation={variation as string}
                onSelect={setDevOverride}
            />
            <Toaster />
        </>
    );
}

export default function App() {
    useEffect(() => {
        // Load features from API (or hydration)
        growthbook.loadFeatures({ autoRefresh: true });
    }, []);

    return (
        <GrowthBookProvider growthbook={growthbook}>
            <AppContent />
        </GrowthBookProvider>
    );
}
