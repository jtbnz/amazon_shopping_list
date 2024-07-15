const OTPAuth = require('otpauth');

// Replace this with your actual secret key you get from the amazon add MFA page - and remove the spaces
const secret = 'YOUR_SECRET_KEY';

// Create a new OTPAuth instance
const totp = new OTPAuth.TOTP({
  issuer: 'YourIssuer',
  label: 'your@email.com',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  secret: OTPAuth.Secret.fromBase32(secret)
});

// Generate OTP
const token = totp.generate();

console.log(`The OTP for your account is: ${token}`);