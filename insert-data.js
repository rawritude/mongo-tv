require('dotenv').config();
const { MongoClient } = require('mongodb');

// Fix: Force IPv4 to match server config
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, { family: 4 });

async function run() {
    try {
        await client.connect();
        console.log("Connected to MongoDB!");

        const database = client.db("stellar");
        const collection = database.collection("test");

        const doc = {
            "txId": "tx_8f3a9c2b1d4e",
            "type": "payment",
            "source": {
                "account": "GA7XYNRF7YNPLQVV4QHZRH",
                "wallet": {
                    "type": "custodial",
                    "provider": "Lobstr",
                    "region": "EU"
                }
            },
            "destination": {
                "account": "GBVFL3E5WK4BTYF9YIVL",
                "wallet": {
                    "type": "self-custody",
                    "provider": null
                }
            },
            "assets": [
                {
                    "code": "XLM",
                    "amount": 15000.50,
                    "issuer": "native"
                },
                {
                    "code": "USDC",
                    "amount": 2500.00,
                    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
                }
            ],
            "fees": {
                "network": 0.00001,
                "service": 0.25,
                "priority": "high"
            },
            "metadata": {
                "memo": "Payment for services #INV-2024-001",
                "tags": ["verified", "business", "recurring"],
                "ipAddress": "192.168.1.100",
                "userAgent": "StellarWallet/2.1.0",
                "geoLocation": {
                    "country": "US",
                    "city": "New York",
                    "latitude": 40.7128,
                    "longitude": -74.0060
                }
            },
            "status": {
                "current": "confirmed",
                "history": [
                    { "state": "pending", "at": new Date("2024-12-19T10:00:00Z") },
                    { "state": "processing", "at": new Date("2024-12-19T10:00:05Z") },
                    { "state": "confirmed", "at": new Date("2024-12-19T10:00:12Z") }
                ]
            },
            "createdAt": new Date(),
            "updatedAt": new Date()
        };

        const result = await collection.insertOne(doc);
        console.log(`Document inserted with _id: ${result.insertedId}`);

    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

run();
