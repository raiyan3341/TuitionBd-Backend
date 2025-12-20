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
const uri  = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dddbozq.mongodb.net/TuitionFinder?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'Unauthorized Access: Missing authorization header' });
    }
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            console.error("JWT Verification Error:", err);
            return res.status(401).send({ error: true, message: 'Unauthorized Access: Invalid or Expired Token' });
        }
        
        req.decoded = decoded;
        next();
    });
};

app.post('/jwt', (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
    res.send({ token });
});


async function run() {
    try {
         await client.connect(); 
        console.log("MongoDB connected successfully!");
        const database = client.db("TuitionFinderDB");
        const usersCollection = database.collection("users");
        const tuitionsCollection = database.collection("tuitions");
        const applicationsCollection = database.collection("applications");
        const paymentsCollection = database.collection("payments");
    
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

       app.post('/users', async (req, res) => {
    const user = req.body;
    const query = { email: user.email };
    

    const existingUser = await usersCollection.findOne(query);
    if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
    }

    const result = await usersCollection.insertOne(user);
    res.send(result);
});


        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query, { projection: { role: 1, name: 1, phone: 1, email: 1 } });
            if (user) {
                res.send(user);
            } else {
                res.status(404).send({ message: 'User not found' });
            }
        });


app.get('/revenue-history', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).send({ message: 'Email is required' });
        }

        const query = { email: email }; 
        const result = await paymentsCollection.find(query).toArray();
        
        res.send(result || []);
    } catch (error) {
        console.error("Revenue History Error:", error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

        app.patch('/users/role/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const newRole = req.body.role;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { role: newRole }
            };
            const result = await usersCollection.updateOne(query, updateDoc);
            res.send(result);
        });
app.patch('/users/update/:email', async (req, res) => {
    const email = req.params.email;
    const { name, phone, address, photo } = req.body;
    const filter = { email: email };
    const updatedDoc = {
        $set: { name, phone, address, photo },
    };
    const result = await usersCollection.updateOne(filter, updatedDoc);
    res.send(result);
});
        app.post('/tuitions', verifyJWT, async (req, res) => {
            const tuition = req.body;
            const tuitionPost = {
                ...tuition,
                status: 'Pending',
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const result = await tuitionsCollection.insertOne(tuitionPost);
            res.send(result);
        });
        app.get('/tuitions', verifyJWT, async (req, res) => {
            const email = req.query.email;
            let query = {};
            
            if (email) {
                query = { studentEmail: email };
            } else {
                const decodedEmail = req.decoded.email;
                const user = await usersCollection.findOne({ email: decodedEmail });
                if (user?.role !== 'Admin') {
                    return res.status(403).send({ error: true, message: 'Forbidden: Admin access required to view all tuitions.' });
                }
            }
            
            const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });
        
        
app.get('/tuitions/my-posts', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).send({ message: "Email is required" });
        }
        
        const query = { studentEmail: email }; 
        const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(result);
    } catch (error) {
        console.error("My Posts Error:", error);
        res.status(500).send({ message: "Internal Server Error", error: error.message });
    }
});
        app.get('/latest-tuitions', async (req, res) => {
            const query = { status: 'Approved' };
            const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).limit(6).toArray();
            res.send(result);
        });
        app.patch('/tuitions/status/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const newStatus = req.body.status;
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { status: newStatus, updatedAt: new Date() }
            };
            const result = await tuitionsCollection.updateOne(query, updateDoc);
            res.send(result);
        });
        
        app.patch('/tuitions/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            const query = { _id: new ObjectId(id) };
            const tuition = await tuitionsCollection.findOne(query);
            if (tuition.studentEmail !== req.decoded.email) {
                 return res.status(403).send({ error: true, message: 'Forbidden: You do not own this post.' });
            }

            const updateDoc = {
                $set: { 
                    ...updatedData, 
                    updatedAt: new Date(),
                    status: 'Pending'
                }
            };
            const result = await tuitionsCollection.updateOne(query, updateDoc);
            res.send(result);
        });

        app.delete('/tuitions/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            
            const decodedEmail = req.decoded.email;
            const user = await usersCollection.findOne({ email: decodedEmail });
            const tuition = await tuitionsCollection.findOne(query);
            if (user?.role === 'Admin' || tuition.studentEmail === decodedEmail) {
                const result = await tuitionsCollection.deleteOne(query);
                res.send(result);
            } else {
                return res.status(403).send({ error: true, message: 'Forbidden: Only the owner or Admin can delete.' });
            }
        });
app.post('/applications', async (req, res) => {
    try {
        const application = req.body;
        const result = await applicationsCollection.insertOne(application);
        res.send(result);
    } catch (error) {
        console.error("Application Post Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});
        app.get('/applications/my-applications', async (req, res) => {
    try {
        const tutorEmail = req.query.email;
        if (!tutorEmail) {
            return res.status(400).send({ message: 'Email is required' });
        }
        const query = { tutorEmail: tutorEmail };
        const result = await applicationsCollection.find(query).sort({ appliedAt: -1 }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send(error);
    }
});
        app.get('/applications/by-student-posts', verifyJWT, async (req, res) => {
            const studentEmail = req.query.email;
            if (req.decoded.email !== studentEmail) {
                 return res.status(403).send({ error: true, message: 'Forbidden: Cannot view other students applications.' });
            }
        
            const studentTuitionPosts = await tuitionsCollection.find({ studentEmail: studentEmail }).toArray();
            const tuitionIds = studentTuitionPosts.map(post => post._id.toString());
            const applications = await applicationsCollection.find({
                tuitionId: { $in: tuitionIds }
            }).sort({ appliedAt: -1 }).toArray();
        
            const populatedApplications = applications.map(app => {
                const tuition = studentTuitionPosts.find(post => post._id.toString() === app.tuitionId);
                return {
                    ...app,
                    tuitionSubject: tuition?.subject,
                    tuitionClass: tuition?.classLevel,
                    tuitionBudget: tuition?.budget,
                    tuitionLocation: tuition?.location,
                };
            });
            
            res.send(populatedApplications);
        });
        app.get('/stats/student/:email', verifyJWT, async (req, res) => {
            const studentEmail = req.params.email;
            if (req.decoded.email !== studentEmail) {
                return res.status(403).send({ error: true, message: 'Forbidden' });
            }
            const totalPosts = await tuitionsCollection.countDocuments({ studentEmail: studentEmail });
            const studentTuitionPosts = await tuitionsCollection.find({ studentEmail: studentEmail }).toArray();
            const tuitionIds = studentTuitionPosts.map(post => post._id.toString());
            const totalApplications = await applicationsCollection.countDocuments({ tuitionId: { $in: tuitionIds } });
            const hiredCount = studentTuitionPosts.filter(post => post.status === 'Paid').length;
            
            res.send({ totalPosts, totalApplications, hiredCount });
        });
        app.get('/stats/tutor/:email', verifyJWT, verifyTutor, async (req, res) => {
            const tutorEmail = req.params.email;
            if (req.decoded.email !== tutorEmail) {
                return res.status(403).send({ error: true, message: 'Forbidden' });
            }
            
            const applications = await applicationsCollection.find({ tutorEmail: tutorEmail }).toArray();
            const totalApplications = applications.length;
            const hiredCount = applications.filter(app => app.status === 'Paid-Confirmed').length;
            const pending = applications.filter(app => app.status === 'Applied').length;
            
            res.send({ totalApplications, hiredCount, pending });
        });
        app.patch('/applications/status/:id', verifyJWT, async (req, res) => {
            const applicationId = req.params.id;
            const { newStatus } = req.body;
            const query = { _id: new ObjectId(applicationId) };
            
            const application = await applicationsCollection.findOne(query);
            if (!application) return res.status(404).send({ message: 'Application not found.' });
            const tuition = await tuitionsCollection.findOne({ _id: new ObjectId(application.tuitionId) });
            if (tuition.studentEmail !== req.decoded.email) {
                 return res.status(403).send({ error: true, message: 'Forbidden: Not the student owner.' });
            }
            
            const updateDoc = {
                $set: { 
                    status: newStatus, 
                    updatedAt: new Date() 
                }
            };
            
            const result = await applicationsCollection.updateOne(query, updateDoc);
            if (newStatus === 'Paid-Confirmed') {
                await tuitionsCollection.updateOne(
                    { _id: new ObjectId(application.tuitionId) },
                    { $set: { status: 'Paid', hiredTutorEmail: application.tutorEmail } } // Record the hired tutor
                );
            }
            
            res.send(result);
        });

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            if (amount < 1) {
                return res.status(400).send({ error: 'Payment amount must be greater than 0.' });
            }

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'bdt',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        app.get('/users/contact/:email', verifyJWT, async (req, res) => {
            const targetEmail = req.params.email;
            const requesterEmail = req.decoded.email;
            
            const requester = await usersCollection.findOne({ email: requesterEmail });
            const target = await usersCollection.findOne({ email: targetEmail }, { projection: { name: 1, email: 1, phone: 1, _id: 0 } });
            
            if (!target) return res.status(404).send({ message: 'Contact not found' });
            let isAuthorized = false;
            
            if (requester?.role === 'Student') {
                const hiredPost = await tuitionsCollection.findOne({ 
                    studentEmail: requesterEmail, 
                    hiredTutorEmail: targetEmail, 
                    status: 'Paid' 
                });
                if (hiredPost) isAuthorized = true;
                
            } else if (requester?.role === 'Tutor') {
                 const hiredApplication = await applicationsCollection.findOne({
                    tutorEmail: requesterEmail,
                    studentEmail: targetEmail,
                    status: 'Paid-Confirmed'
                });
                if (hiredApplication) isAuthorized = true;
            }
            
            if (isAuthorized || requester?.role === 'Admin') { 
                res.send(target);
            } else {
                res.status(403).send({ error: true, message: 'Forbidden: Not authorized to view contact details.' });
            }
        });
        app.get('/tutors', async (req, res) => {
            try {
                const query = { role: 'Tutor' };
                

                const tutors = await usersCollection.find(query)
                    .project({ name: 1, email: 1, subjects: 1, experience: 1, education: 1, area: 1, _id: 0 }) 
                    .toArray();
                
                res.send(tutors);
            } catch (error) {
                console.error("Error fetching tutors list:", error); 
                res.status(500).send({ error: true, message: 'Failed to fetch tutors list' });
            }
        });
        

    } finally {

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
            res.send('Tuition Finder Server is Running!');
        });

        app.get('/tuitions/approved', async (req, res) => {
            const query = { status: 'Approved' };
            const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Tuition Finder Server listening on port ${port}`);
    });
}

module.exports = app;