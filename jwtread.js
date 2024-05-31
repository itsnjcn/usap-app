const express = require('express');
const cookieParser = require('cookie-parser');
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');

// The Application Audience (AUD) tag for your application
const AUD = process.env.POLICY_AUD;

// Your CF Access team domain
const TEAM_DOMAIN = process.env.TEAM_DOMAIN;
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;

const client = jwksClient({
  jwksUri: CERTS_URL
});

const getKey = (header, callback) => {
  client.getSigningKey(header.kid, function(err, key) {
    callback(err, key?.getPublicKey());
  });
}

// verifyToken is a middleware to verify a CF authorization token
const verifyToken = (req, res, next) => {
  const token = req.cookies['CF_Authorization'];

  // Make sure that the incoming request has our token header
  if (!token) {
    return res.status(403).send({ status: false, message: 'missing required cf authorization token' });
  }

  jwt.verify(token, getKey, { audience: AUD }, (err, decoded) => {
    if (err) {
      return res.status(403).send({ status: false, message: 'invalid token' });
    }

    req.user = decoded;
    next();
  });
}

const app = express();

app.use(cookieParser());
app.use(verifyToken);

app.get('/', (req, res) => {
  // Create a json file to collect simple user data from JWT's payload such as NAME, and EMAIL
  const userData = {
    name: req.user.name, // Assuming 'name' is a field in the JWT payload
    email: req.user.email // Assuming 'email' is a field in the JWT payload
  };

  // Write userData to a JSON file
  fs.writeFile('userData.json', JSON.stringify(userData), (err) => {
    if (err) {
      console.error('Error writing JSON file:', err);
      return res.status(500).send({ status: false, message: 'error writing JSON file' });
    }
    console.log('JSON file written successfully');

    console.log('Hello World! from jwtread.js');
  });
});

app.listen(3333)