const https = require('https');

// Test initializeSystem
function testInitializeSystem() {
  const data = JSON.stringify({
    data: {}
  });

  const options = {
    hostname: 'us-central1-pointhub-ab054.cloudfunctions.net',
    port: 443,
    path: '/initializeSystem',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    
    res.on('end', () => {
      console.log('initializeSystem response:', body);
    });
  });

  req.on('error', (error) => {
    console.error('Error calling initializeSystem:', error);
  });

  req.write(data);
  req.end();
}

// Test createUserProfile 
function testCreateUserProfile() {
  const data = JSON.stringify({
    data: {
      uid: 'test-user-123',
      email: 'test@example.com'
    }
  });

  const options = {
    hostname: 'us-central1-pointhub-ab054.cloudfunctions.net',
    port: 443,
    path: '/createUserProfile',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    
    res.on('end', () => {
      console.log('createUserProfile response:', body);
    });
  });

  req.on('error', (error) => {
    console.error('Error calling createUserProfile:', error);
  });

  req.write(data);
  req.end();
}

console.log('Testing Firebase Functions...');
testInitializeSystem();

setTimeout(() => {
  testCreateUserProfile();
}, 2000);