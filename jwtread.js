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
  res.send('Hello World!');
});

app.listen(3333)