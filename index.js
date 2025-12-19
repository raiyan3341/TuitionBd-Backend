require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken'); // 👈 Import JWT
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 3000;


app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174'], 
    credentials: true,
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

        
        // ==============================================
        // 7. Users APIs (Phase 3 & Dashboard Access)
        // ==============================================

        // C: Save user on registration/social login
       app.post('/users', async (req, res) => {
    const user = req.body;
    const query = { email: user.email };
    
    // চেক করুন ইউজার কি আগে থেকেই আছে?
    const existingUser = await usersCollection.findOne(query);
    if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
    }

    const result = await usersCollection.insertOne(user);
    res.send(result);
});

        // R: Get all users (Admin Route)
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // R: Get a single user's role (Used for DashboardLayout & Navbar)
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

        // রেভিনিউ হিস্ট্রি পাওয়ার API
// index.js (Backend)

app.get('/revenue-history', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).send({ message: 'Email is required' });
        }

        // 💡 আপনার ডাটাবেস অনুযায়ী কুয়েরি ঠিক করুন
        // যদি আপনি অ্যাডমিন হন, তবে হয়তো আপনি সব ডাটা দেখতে চান
        // আর যদি শুধু নির্দিষ্ট ইউজারের ডাটা হয় তবে: { email: email }
        const query = { email: email }; 
        
        // কালেকশনের নাম আপনার ডাটাবেস অনুযায়ী চেক করুন (যেমন: paymentsCollection)
        const result = await paymentsCollection.find(query).toArray();
        
        res.send(result || []);
    } catch (error) {
        console.error("Revenue History Error:", error);
        res.status(500).send({ message: 'Internal Server Error', error: error.message });
    }
});

        // U: Update user role (Admin Route)
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
        // ইউজার প্রোফাইল আপডেট করার API
app.patch('/users/update/:email', async (req, res) => {
    const email = req.params.email;
    const { name, phone, address, photo } = req.body;
    const filter = { email: email };
    const updatedDoc = {
        $set: { name, phone, address, photo }, // এখানে photo সরাসরি টেক্সট হিসেবে স্টোর হবে
    };
    const result = await usersCollection.updateOne(filter, updatedDoc);
    res.send(result);
});
        // D: Delete a user (Optional Admin Route)
        // app.delete('/users/:id', verifyJWT, verifyAdmin, async (req, res) => { ... });

        // ==============================================
        // 8. Tuition Posts APIs (Phase 4, 5, 6)
        // ==============================================

        // C: Post new tuition (Student Route)
        app.post('/tuitions', verifyJWT, async (req, res) => {
            const tuition = req.body;
            const tuitionPost = {
                ...tuition,
                status: 'Pending', // Default status for admin approval
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const result = await tuitionsCollection.insertOne(tuitionPost);
            res.send(result);
        });
        
        // R: Get all tuitions (Admin Route) OR Get student's tuitions by email (Student Route)
        app.get('/tuitions', verifyJWT, async (req, res) => {
            const email = req.query.email;
            let query = {};
            
            if (email) { // Student-specific posts
                query = { studentEmail: email };
            } else { // Admin view (all posts)
                // This route should be protected for Admin only if email is not present
                const decodedEmail = req.decoded.email;
                const user = await usersCollection.findOne({ email: decodedEmail });
                if (user?.role !== 'Admin') {
                    // console.log('Forbidden: Not Admin viewing all tuitions');
                    return res.status(403).send({ error: true, message: 'Forbidden: Admin access required to view all tuitions.' });
                }
            }
            
            const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        // R: Get all approved tuitions (Public/Tutor Listing - Phase 6)
        app.get('/tuitions/approved', async (req, res) => {
            const query = { status: 'Approved' };
            const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });
        
app.get('/tuitions/my-posts', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).send({ message: "Email is required" });
        }
        
        // সঠিক কুয়েরি এবং কালেকশন নেম (tuitionsCollection)
        const query = { studentEmail: email }; 
        
        // 💡 FIX: tuitionCollection -> tuitionsCollection
        const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(result);
    } catch (error) {
        console.error("My Posts Error:", error);
        res.status(500).send({ message: "Internal Server Error", error: error.message });
    }
});

        // R: Get latest approved tuitions for Home Page
        app.get('/latest-tuitions', async (req, res) => {
            const query = { status: 'Approved' };
            const result = await tuitionsCollection.find(query).sort({ createdAt: -1 }).limit(6).toArray();
            res.send(result);
        });

        // U: Update tuition status (Admin Route)
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
        
        // U: Update tuition details (Student Route)
        app.patch('/tuitions/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            const query = { _id: new ObjectId(id) };
            
            // Only allow update if the user is the owner (optional but recommended)
            const tuition = await tuitionsCollection.findOne(query);
            if (tuition.studentEmail !== req.decoded.email) {
                 return res.status(403).send({ error: true, message: 'Forbidden: You do not own this post.' });
            }

            const updateDoc = {
                $set: { 
                    ...updatedData, 
                    updatedAt: new Date(),
                    status: 'Pending' // Revert to Pending after update for re-approval
                }
            };
            const result = await tuitionsCollection.updateOne(query, updateDoc);
            res.send(result);
        });

        // D: Delete a tuition post (Admin/Student Route)
        app.delete('/tuitions/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            
            const decodedEmail = req.decoded.email;
            const user = await usersCollection.findOne({ email: decodedEmail });
            const tuition = await tuitionsCollection.findOne(query);

            // Authorization Check
            if (user?.role === 'Admin' || tuition.studentEmail === decodedEmail) {
                const result = await tuitionsCollection.deleteOne(query);
                res.send(result);
            } else {
                return res.status(403).send({ error: true, message: 'Forbidden: Only the owner or Admin can delete.' });
            }
        });
        
        
        // ==============================================
        // 9. Tuition Applications APIs (Phase 7, 8, 10)
        // ==============================================

        // C: Apply for a tuition post (Tutor Route)
        // Backend: server/index.js
app.post('/applications', async (req, res) => {
    try {
        const application = req.body;
        // 💡 FIX: নিশ্চিত করুন applicationsCollection ভেরিয়েবলটি ব্যবহার করছেন
        const result = await applicationsCollection.insertOne(application);
        res.send(result);
    } catch (error) {
        console.error("Application Post Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
    }
});

        // R: Get applications made by a specific tutor (Tutor Home - Phase 7)
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
        
        // R: Get applications for a student's posts (Student Home - Phase 8)
        app.get('/applications/by-student-posts', verifyJWT, async (req, res) => {
            const studentEmail = req.query.email;
            if (req.decoded.email !== studentEmail) {
                 return res.status(403).send({ error: true, message: 'Forbidden: Cannot view other students applications.' });
            }
            
            // 1. Find all tuition posts by the student
            const studentTuitionPosts = await tuitionsCollection.find({ studentEmail: studentEmail }).toArray();
            const tuitionIds = studentTuitionPosts.map(post => post._id.toString()); // Convert ObjectIds to strings

            // 2. Find all applications related to these posts
            const applications = await applicationsCollection.find({
                tuitionId: { $in: tuitionIds }
            }).sort({ appliedAt: -1 }).toArray();
            
            // 3. Attach tuition details to each application
            const populatedApplications = applications.map(app => {
                const tuition = studentTuitionPosts.find(post => post._id.toString() === app.tuitionId);
                return {
                    ...app,
                    tuitionSubject: tuition?.subject,
                    tuitionClass: tuition?.classLevel,
                    tuitionBudget: tuition?.budget,
                    tuitionLocation: tuition?.location,
                    // Note: tutorName and tutorEmail already in app
                };
            });
            
            res.send(populatedApplications);
        });
        
        // R: Get student stats (Student Home)
        app.get('/stats/student/:email', verifyJWT, async (req, res) => {
            const studentEmail = req.params.email;
            if (req.decoded.email !== studentEmail) {
                return res.status(403).send({ error: true, message: 'Forbidden' });
            }
            
            // 1. Total Posts
            const totalPosts = await tuitionsCollection.countDocuments({ studentEmail: studentEmail });
            
            // 2. Total Applications (across all posts)
            const studentTuitionPosts = await tuitionsCollection.find({ studentEmail: studentEmail }).toArray();
            const tuitionIds = studentTuitionPosts.map(post => post._id.toString());
            const totalApplications = await applicationsCollection.countDocuments({ tuitionId: { $in: tuitionIds } });
            
            // 3. Hired Tutor (Status: Paid)
            const hiredCount = studentTuitionPosts.filter(post => post.status === 'Paid').length;
            
            res.send({ totalPosts, totalApplications, hiredCount });
        });
        
        // R: Get tutor stats (Tutor Home)
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
        
        // U: Hire Tutor/Update Application Status to 'Hired' or 'Paid' (Student Route)
        app.patch('/applications/status/:id', verifyJWT, async (req, res) => {
            const applicationId = req.params.id;
            const { newStatus } = req.body;
            const query = { _id: new ObjectId(applicationId) };
            
            const application = await applicationsCollection.findOne(query);
            if (!application) return res.status(404).send({ message: 'Application not found.' });

            // Ensure the user is the student owner of the tuition post (Optional but recommended)
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
            
            // If status is 'Paid', also update the main tuition post status to 'Paid'
            if (newStatus === 'Paid-Confirmed') {
                await tuitionsCollection.updateOne(
                    { _id: new ObjectId(application.tuitionId) },
                    { $set: { status: 'Paid', hiredTutorEmail: application.tutorEmail } } // Record the hired tutor
                );
            }
            
            res.send(result);
        });


        // ==============================================
        // 10. Payment and Contact Info APIs (Phase 9, 10)
        // ==============================================

        // C: Create Payment Intent (Stripe)
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100); // Stripe expects amount in cents/paisa

            if (amount < 1) { // Basic validation
                return res.status(400).send({ error: 'Payment amount must be greater than 0.' });
            }

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'bdt', // Assuming you are using BDT
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        
        // R: Get Contact Info (Student for Tutor, Tutor for Student)
        app.get('/users/contact/:email', verifyJWT, async (req, res) => {
            const targetEmail = req.params.email; // Email of the person whose contact is requested
            const requesterEmail = req.decoded.email;
            
            const requester = await usersCollection.findOne({ email: requesterEmail });
            const target = await usersCollection.findOne({ email: targetEmail }, { projection: { name: 1, email: 1, phone: 1, _id: 0 } });
            
            if (!target) return res.status(404).send({ message: 'Contact not found' });
            
            // Authorization Check: Must be the hired student/tutor
            let isAuthorized = false;
            
            if (requester?.role === 'Student') {
                // Check if the student has hired the target tutor
                const hiredPost = await tuitionsCollection.findOne({ 
                    studentEmail: requesterEmail, 
                    hiredTutorEmail: targetEmail, 
                    status: 'Paid' 
                });
                if (hiredPost) isAuthorized = true;
                
            } else if (requester?.role === 'Tutor') {
                // Check if the tutor was hired by the target student
                 const hiredApplication = await applicationsCollection.findOne({
                    tutorEmail: requesterEmail,
                    studentEmail: targetEmail,
                    status: 'Paid-Confirmed'
                });
                if (hiredApplication) isAuthorized = true;
            }
            
            if (isAuthorized || requester?.role === 'Admin') { // Admin can view any contact
                res.send(target);
            } else {
                // console.log('Forbidden: Contact info not authorized');
                res.status(403).send({ error: true, message: 'Forbidden: Not authorized to view contact details.' });
            }
        });

        // ==============================================\r\n
        // 11. Public Tutors Listing (Phase 11)
        // ==============================================
        
        // R: Get all registered Tutors (Publicly accessible)
        app.get('/tutors', async (req, res) => {
            try {
                const query = { role: 'Tutor' };
                
                // Only return public profile fields
                const tutors = await usersCollection.find(query)
                                        .project({ name: 1, email: 1, subjects: 1, experience: 1, education: 1, area: 1, _id: 0 }) 
                                        .toArray();
                
                res.send(tutors);
            } catch (error) {
                console.error("Error fetching tutors list:", error); 
                res.status(500).send({ error: true, message: 'Failed to fetch tutors list' });
            }
        });


        // Ping for deployment status
        app.get('/', (req, res) => {
            res.send('Tuition Finder Server is Running!');
        });


    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


// ==============================================
// 12. Start Server
// ==============================================
app.listen(port, () => {
    console.log(`Tuition Finder Server listening on port ${port}`);
});