# 🎓 Tuition Management System – Backend

This is the **backend server** of the Tuition Management System.  
It handles authentication, business logic, database operations, and secure payments.

---

## 🌟 Application Overview

The backend provides:
- RESTful APIs for frontend consumption
- Secure authentication using Firebase & JWT
- Role-based authorization
- Tuition, application & payment management
- Admin-level reporting & analytics

All backend logic is implemented inside a single `index.js` file for simplicity.

---

## 🚀 Key Features

### Authentication & Security
- Firebase Admin SDK token verification
- JWT-based protected routes
- Role-based access control (Student, Tutor, Admin)

### Tuition Management
- Students can create, update & delete tuition posts
- Admin approval required before tutor visibility
- Tuition status tracking (Pending / Approved / Rejected)

### Tutor Application System
- Tutors can apply for approved tuition posts
- Students can accept or reject applications
- Tutor approval only after successful payment

### Payment System
- Stripe payment intent integration
- Secure transaction handling
- Payment history stored in MongoDB

### Admin Features
- User management (view, update, delete, role change)
- Tuition moderation
- Platform transaction reports

---

## 🧑‍💻 Tech Stack

- **Node.js**
- **Express.js**
- **MongoDB (Mongoose)**
- **Firebase Admin SDK**
- **Stripe API**
- **JWT Authentication**

---

## 📌 Notes
- All APIs are centralized in `index.js`
- Database uses MongoDB with Mongoose models
- Designed to match frontend role-based workflow

© Tuition Management System – Backend

