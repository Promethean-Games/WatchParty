// firebase-config.js

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCpazEeNdcXp4L0KDg4JQ_cjwT6lgLZWAY",
  authDomain: "watch-party-v1.firebaseapp.com",
  databaseURL: "https://watch-party-v1-default-rtdb.firebaseio.com",
  projectId: "watch-party-v1",
  storageBucket: "watch-party-v1.firebasestorage.app",
  messagingSenderId: "686201042880",
  appId: "1:686201042880:web:55be33ec9df0dd2087ba25",
  measurementId: "G-BZGPSLHHMZ"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Realtime Database reference we use in app.js
const db = firebase.database();

// Firebase Auth reference
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();
