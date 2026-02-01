import { handleRequest } from '@growthbook/edge-cloudflare';

export default {
    async fetch(request: Request, env: any, ctx: any) {
        return await handleRequest(request, env, ctx);
    },
};
