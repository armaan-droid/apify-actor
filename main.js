import { Actor } from 'apify';
import { PlaywrightCrawler, Session } from '@crawlee/playwright';

export const INPUT_SCHEMA = {
    schemaVersion: 1,
    title: 'Session Metamorph Actor Input',
    type: 'object',
    properties: {
        phpsessid: {
            title: 'PHP Session ID',
            type: 'string',
            description: 'The PHPSESSID cookie value to be preserved in the session',
            editor: 'textfield'
        },
        domain: {
            title: 'Cookie Domain',
            type: 'string',
            description: 'The domain for the PHPSESSID cookie (e.g., ".example.com")',
            editor: 'textfield'
        },
        innerInput: {
            title: 'Inner Actor Input',
            type: 'object',
            description: 'Input data to pass to the target actor after metamorphosis',
            editor: 'json'
        },
        targetActorId: {
            title: 'Target Actor ID',
            type: 'string',
            description: 'The ID of the actor to call with the session',
            editor: 'textfield',
            default: 'dCWf2xghxeZgpcrsQ'
        }
    },
    required: ['phpsessid', 'domain']
}; // keeps TypeScript quiet if you're on TS

await Actor.init();

const { phpsessid, domain, innerInput = {}, targetActorId = 'dCWf2xghxeZgpcrsQ' } = await Actor.getInput();

/**
 * 1)  Spin up an ultra-light crawler only to create
 *     a Session that already contains the PHPSESSID cookie.
 *     No pages are actually scraped.
 */
const crawler = new PlaywrightCrawler({
    // Nothing to crawl; we just want the SessionPool persisted
    maxRequestsPerCrawl: 0,

    useSessionPool: true,
    persistCookiesPerSession: true,                 // SDK will keep cookies fresh
    sessionPoolOptions: {
        maxPoolSize: 1,                             // one "user" is enough
        createSessionFunction: (pool) => {
            const session = new Session({ sessionPool: pool });

            session.setCookies([{
                name: 'PHPSESSID',
                value: phpsessid,
                domain,                             // e.g. ".example.com"
                path: '/',
                httpOnly: true,
                secure: true,
            }]);

            return session;                         // cookie now lives in the SessionPool
        },
    },
});

// Actually open no pages – just initialise the pool
await crawler.run();

/**
 * 2)  Store session data in key-value store and call target actor
 *     This approach preserves session data in a way that can be accessed
 *     by the target actor if needed
 */
try {
    console.log(`Preparing to call target actor: ${targetActorId}`);
    
    // Store session data in key-value store for potential access by target actor
    const kvStore = await Actor.openKeyValueStore();
    const sessionData = {
        phpsessid,
        domain,
        cookieData: [{
            name: 'PHPSESSID',
            value: phpsessid,
            domain: domain,
            path: '/',
            httpOnly: true,
            secure: true,
        }],
        timestamp: new Date().toISOString()
    };
    
    await kvStore.setValue('SESSION_DATA', sessionData);
    console.log('Session data stored in key-value store');
    
    // Prepare input with session information and KV store reference
    const targetInput = {
        ...innerInput,
        // Pass session cookie information to the target actor
        sessionCookie: {
            name: 'PHPSESSID',
            value: phpsessid,
            domain: domain
        },
        // Also pass KV store ID if target actor needs to access full session data
        sessionDataStore: kvStore.id
    };

    console.log(`Calling target actor: ${targetActorId}`);
    
    // Call the target actor
    const run = await Actor.call(targetActorId, targetInput);
    
    console.log(`Target actor run completed. Run ID: ${run.id}`);
    
    // Optionally, you can get the results from the target actor
    if (run.defaultDatasetId) {
        const dataset = await Actor.openDataset(run.defaultDatasetId);
        const { items } = await dataset.getData();
        
        // Push results to this actor's dataset
        if (items && items.length > 0) {
            await Actor.pushData(items);
            console.log(`Transferred ${items.length} items from target actor to this actor's dataset`);
        }
    }
    
} catch (error) {
    console.error('Error calling target actor:', error);
    throw error;
}

await Actor.exit();
