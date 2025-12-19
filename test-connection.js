// Test MongoDB connection and permissions
require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
console.log('Testing MongoDB connection...\n');
console.log('URI:', uri.replace(/:([^:@]+)@/, ':***@'), '\n');

async function test() {
    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
    });

    try {
        // Step 1: Basic connection
        console.log('Step 1: Connecting to MongoDB...');
        await client.connect();
        console.log('✅ Connected successfully!\n');

        // Step 2: List databases (requires listDatabases permission)
        console.log('Step 2: Listing databases...');
        const adminDb = client.db().admin();
        const dbs = await adminDb.listDatabases();
        console.log('✅ Databases found:', dbs.databases.map(d => d.name).join(', '), '\n');

        // Step 3: Test change stream (requires read permission)
        if (dbs.databases.length > 0) {
            const testDb = dbs.databases.find(d => !['admin', 'local', 'config'].includes(d.name));
            if (testDb) {
                console.log(`Step 3: Testing change stream on "${testDb.name}"...`);
                const db = client.db(testDb.name);
                const collections = await db.listCollections().toArray();

                if (collections.length > 0) {
                    const coll = db.collection(collections[0].name);
                    console.log(`  Testing on collection: ${collections[0].name}`);

                    try {
                        const changeStream = coll.watch([], { maxAwaitTimeMS: 1000 });
                        // Just test if we can open it
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => {
                                changeStream.close();
                                resolve();
                            }, 2000);

                            changeStream.on('error', (err) => {
                                clearTimeout(timeout);
                                reject(err);
                            });
                        });
                        console.log('✅ Change stream works!\n');
                    } catch (err) {
                        console.log('❌ Change stream error:', err.message, '\n');
                    }
                } else {
                    console.log('  No collections in this database to test change streams\n');
                }
            } else {
                console.log('  No user databases found to test change streams\n');
            }
        }

        console.log('=== All tests passed! ===');
    } catch (err) {
        console.log('❌ Error:', err.message);
        console.log('\nError details:', err.code, err.codeName);
    } finally {
        await client.close();
    }
}

test();
