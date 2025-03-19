import crypto from 'crypto';

// Function to generate a secure token
export function generateToken(userId) {
  const timestamp = Date.now();
  const data = `${userId}-${timestamp}-${process.env.SECRET_KEY}`;
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return `${userId}.${timestamp}.${hash}`;
}

// Function to validate token
export function validateToken(token) {
  if (!token) return null;
  
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  const [userId, timestamp, hash] = parts;
  
  // Check if token is expired (1 hour)
  if (Date.now() - parseInt(timestamp) > 3600000) {
    return null;
  }
  
  // Verify hash
  const data = `${userId}-${timestamp}-${process.env.SECRET_KEY}`;
  const expectedHash = crypto.createHash('sha256').update(data).digest('hex');
  
  return hash === expectedHash ? userId : null;
}
