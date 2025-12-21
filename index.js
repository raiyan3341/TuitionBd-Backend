require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;


app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://tuition-bd-frontend.vercel.app"
    ],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dddbozq.mongodb.net/TuitionFinder?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


let usersCollection, tuitionsCollection, applicationsCollection, paymentsCollection;

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'Unauthorized Access: Missing authorization header' });
    }
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'Unauthorized Access: Invalid or Expired Token' });
        }
        req.decoded = decoded;
        next();
    });
};

async function run() {
    try {
        await client.connect();
        console.log("MongoDB connected successfully!");
        const database = client.db("TuitionFinderDB");

        usersCollection = database.collection("users");
        tuitionsCollection = database.collection("tuitions");
        applicationsCollection = database.collection("applications");
        paymentsCollection = database.collection("payments");

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await usersCollection.findOne({ email: email });
            if (user?.role !== 'Admin') {
                return res.status(403).send({ error: true, message: 'Forbidden Access: Requires Admin role' });
            }
            next();
        };

        const verifyTutor = async (req, res, next) => {
            const email = req.decoded.email;
            const user = await usersCollection.findOne({ email: email });
            if (user?.role !== 'Tutor') {
                return res.status(403).send({ error: true, message: 'Forbidden Access: Requires Tutor role' });
            }
            next();
        };

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });


        app.post('/users', async (req, res) => {
            const user = req.body;
            const existingUser = await usersCollection.findOne({ email: user.email });
            if (existingUser) return res.send({ message: 'User already exists', insertedId: null });
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get('/users/:email', async (req, res) => {
            const user = await usersCollection.findOne({ email: req.params.email }, { projection: { role: 1, name: 1, phone: 1, email: 1, address: 1, photo: 1 } });
            user ? res.send(user) : res.status(404).send({ message: 'User not found' });
        });

        app.patch('/users/role/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { role: req.body.role } });
            res.send(result);
        });

        app.patch('/users/update/:email', async (req, res) => {
            const { name, phone, address, photo } = req.body;
            const result = await usersCollection.updateOne({ email: req.params.email }, { $set: { name, phone, address, photo } });
            res.send(result);
        });

        app.get('/users/contact/:email', verifyJWT, async (req, res) => {
            const targetEmail = req.params.email;
            const requesterEmail = req.decoded.email;
            const requester = await usersCollection.findOne({ email: requesterEmail });
            const target = await usersCollection.findOne({ email: targetEmail }, { projection: { name: 1, email: 1, phone: 1, _id: 0 } });
            
            if (!target) return res.status(404).send({ message: 'Contact not found' });
            let isAuthorized = false;

            if (requester?.role === 'Student') {
                const hiredPost = await tuitionsCollection.findOne({ studentEmail: requesterEmail, hiredTutorEmail: targetEmail, status: 'Paid' });
                if (hiredPost) isAuthorized = true;
            } else if (requester?.role === 'Tutor') {
                const hiredApp = await applicationsCollection.findOne({ tutorEmail: requesterEmail, studentEmail: targetEmail, status: 'Paid-Confirmed' });
                if (hiredApp) isAuthorized = true;
            }

            if (isAuthorized || requester?.role === 'Admin') res.send(target);
            else res.status(403).send({ error: true, message: 'Forbidden: Not authorized' });
        });

        app.get('/tutors', async (req, res) => {
            const result = await usersCollection.find({ role: 'Tutor' })
                .project({ name: 1, email: 1, subjects: 1, experience: 1, education: 1, area: 1, _id: 0 }).toArray();
            res.send(result);
        });

        app.post('/tuitions', verifyJWT, async (req, res) => {
            const result = await tuitionsCollection.insertOne({ ...req.body, status: 'Pending', createdAt: new Date(), updatedAt: new Date() });
            res.send(result);
        });

        app.get('/tuitions', verifyJWT, async (req, res) => {
            const email = req.query.email;
            let query = email ? { studentEmail: email } : {};
            if (!email) {
                const user = await usersCollection.findOne({ email: req.decoded.email });
                if (user?.role !== 'Admin') return res.status(403).send({ error: true, message: 'Admin access required' });
            }
            const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        app.get('/tuitions/approved', async (req, res) => {
            const result = await tuitionsCollection.find({ status: 'Approved' }).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        app.get('/latest-tuitions', async (req, res) => {
            const result = await tuitionsCollection.find({ status: 'Approved' }).sort({ createdAt: -1 }).limit(6).toArray();
            res.send(result);
        });

        app.get('/tuitions/my-posts', async (req, res) => {
            const result = await tuitionsCollection.find({ studentEmail: req.query.email }).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        app.patch('/tuitions/status/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await tuitionsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: req.body.status, updatedAt: new Date() } });
            res.send(result);
        });

        app.delete('/tuitions/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const decodedEmail = req.decoded.email;
            const user = await usersCollection.findOne({ email: decodedEmail });
            const tuition = await tuitionsCollection.findOne({ _id: new ObjectId(id) });
            if (user?.role === 'Admin' || tuition?.studentEmail === decodedEmail) {
                const result = await tuitionsCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } else res.status(403).send({ message: 'Forbidden' });
        });

        app.post('/applications', async (req, res) => {
            const result = await applicationsCollection.insertOne(req.body);
            res.send(result);
        });

        app.get('/applications/my-applications', async (req, res) => {
            const result = await applicationsCollection.find({ tutorEmail: req.query.email }).sort({ appliedAt: -1 }).toArray();
            res.send(result);
        });

        app.get('/applications/by-student-posts', verifyJWT, async (req, res) => {
            const studentEmail = req.query.email;
            if (req.decoded.email !== studentEmail) return res.status(403).send({ message: 'Forbidden' });
            const studentPosts = await tuitionsCollection.find({ studentEmail }).toArray();
            const tuitionIds = studentPosts.map(p => p._id.toString());
            const apps = await applicationsCollection.find({ tuitionId: { $in: tuitionIds } }).sort({ appliedAt: -1 }).toArray();
            const populated = apps.map(a => {
                const t = studentPosts.find(p => p._id.toString() === a.tuitionId);
                return { ...a, tuitionSubject: t?.subject, tuitionClass: t?.classLevel, tuitionLocation: t?.location };
            });
            res.send(populated);
        });

        app.patch('/applications/status/:id', verifyJWT, async (req, res) => {
            const appQuery = { _id: new ObjectId(req.params.id) };
            const application = await applicationsCollection.findOne(appQuery);
            const { newStatus } = req.body;
            const result = await applicationsCollection.updateOne(appQuery, { $set: { status: newStatus, updatedAt: new Date() } });
            if (newStatus === 'Paid-Confirmed') {
                await tuitionsCollection.updateOne({ _id: new ObjectId(application.tuitionId) }, { $set: { status: 'Paid', hiredTutorEmail: application.tutorEmail } });
            }
            res.send(result);
        });

        app.get('/stats/student/:email', verifyJWT, async (req, res) => {
            const studentEmail = req.params.email;
            const totalPosts = await tuitionsCollection.countDocuments({ studentEmail });
            const posts = await tuitionsCollection.find({ studentEmail }).toArray();
            const tIds = posts.map(p => p._id.toString());
            const totalApps = await applicationsCollection.countDocuments({ tuitionId: { $in: tIds } });
            const hiredCount = posts.filter(p => p.status === 'Paid').length;
            res.send({ totalPosts, totalApplications: totalApps, hiredCount });
        });

        app.get('/stats/tutor/:email', verifyJWT, verifyTutor, async (req, res) => {
            const apps = await applicationsCollection.find({ tutorEmail: req.params.email }).toArray();
            res.send({ totalApplications: apps.length, hiredCount: apps.filter(a => a.status === 'Paid-Confirmed').length, pending: apps.filter(a => a.status === 'Applied').length });
        });

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const amount = parseInt(req.body.price * 100);
            if (amount < 1) return res.status(400).send({ error: 'Invalid amount' });
            const paymentIntent = await stripe.paymentIntents.create({ amount, currency: 'bdt', payment_method_types: ['card'] });
            res.send({ clientSecret: paymentIntent.client_secret });
        });

        app.get('/revenue-history', async (req, res) => {
            const result = await paymentsCollection.find({ email: req.query.email }).toArray();
            res.send(result || []);
        });

    } finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Tuition Finder Server is Running!');
});


if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Tuition Finder Server listening on port ${port}`);
    });
}

module.exports = app;