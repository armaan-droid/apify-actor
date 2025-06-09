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
 * 2)  Create shared storage that the target actor can access
 *     and call it with memory/build options to inherit storage
 */
try {
    console.log(`Preparing to call target actor: ${targetActorId}`);
    
    // Get current run info to create shared storage names
    const currentRun = await Actor.getValue('ACTOR_RUN_ID') || process.env.ACTOR_RUN_ID;
    console.log('Current run ID:', currentRun);
    
    // Create named storage that the target actor can access
    const sharedKvStoreName = `shared-session-${currentRun}`;
    const sharedKvStore = await Actor.openKeyValueStore(sharedKvStoreName);
    
    // Store session data in multiple formats the target actor might expect
    const sessionData = {
        phpsessid,
        domain,
        cookie: {
            name: 'PHPSESSID',
            value: phpsessid,
            domain: domain,
            path: '/',
            httpOnly: true,
            secure: true,
        },
        timestamp: new Date().toISOString()
    };
    
    await sharedKvStore.setValue('SESSION_DATA', sessionData);
    await sharedKvStore.setValue('PHPSESSID', phpsessid);
    console.log(`Session data stored in shared KV store: ${sharedKvStoreName}`);

    // Call the target actor with memory and shared storage options
    console.log(`Calling target actor: ${targetActorId} with shared storage`);
    
    const run = await Actor.call(targetActorId, innerInput, {
        memory: 1024, // Ensure enough memory
        // Pass the shared storage in environment variables that the target actor might check
        env: {
            SHARED_SESSION_STORE: sharedKvStoreName,
            PHPSESSID: phpsessid,
            COOKIE_DOMAIN: domain
        }
    });
    
    console.log(`Target actor run started. Run ID: ${run.id}`);
    
    // Wait for the run to finish
    let finalRun = run;
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 2 minutes (60 * 2 seconds)
    
    while (['RUNNING', 'READY'].includes(finalRun.status) && attempts < maxAttempts) {
        console.log(`Waiting for target actor to complete... Status: ${finalRun.status} (attempt ${attempts + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        
        // Get updated run status
        const client = Actor.newClient();
        finalRun = await client.run(run.id).get();
        attempts++;
    }
    
    console.log(`Target actor completed. Final status: ${finalRun.status}`);
    
    if (finalRun.status === 'FAILED') {
        console.error('Target actor failed. Check its logs for details.');
    }
    
    // Get results from the target actor
    if (finalRun.defaultDatasetId) {
        const dataset = await Actor.openDataset(finalRun.defaultDatasetId);
        const { items } = await dataset.getData();
        
        console.log(`Found ${items?.length || 0} items in target actor's dataset`);
        
        if (items && items.length > 0) {
            await Actor.pushData(items);
            console.log(`Transferred ${items.length} items from target actor to this actor's dataset`);
        }
    }
    
} catch (error) {
    console.error('Error calling target actor:', error);
    
    // Push error info to dataset
    await Actor.pushData({
        error: true,
        message: error.message,
        approach: 'shared-storage-call',
        timestamp: new Date().toISOString()
    });
}

await Actor.exit();
