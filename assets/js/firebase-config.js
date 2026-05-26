const firebaseConfig = {
  apiKey:            "AIzaSyBOHybafMLIyyAPvWPmgwM_-iV04GFk6-w",
  authDomain:        "epc-prc-dashboard.firebaseapp.com",
  projectId:         "epc-prc-dashboard",
  storageBucket:     "epc-prc-dashboard.firebasestorage.app",
  messagingSenderId: "68771690609",
  appId:             "1:68771690609:web:e053565dfdb758349883d0"
};
firebase.initializeApp(firebaseConfig);
const Auth = firebase.auth();
const DB   = firebase.firestore();
