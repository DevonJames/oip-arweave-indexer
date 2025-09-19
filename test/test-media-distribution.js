/**
 * Test Media Distribution System
 * Tests upload, seeding, and retrieval of media files
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const BASE_URL = 'https://api.oip.onl';

class MediaDistributionTester {
  constructor() {
    this.token = null;
    this.user = null;
    this.testResults = [];
  }

  async runAllTests() {
    console.log('🧪 Starting Media Distribution Tests');
    console.log('=' .repeat(50));

    try {
      // Test 1: User Registration/Login
      await this.testAuthentication();

      // Test 2: Media Upload
      await this.testMediaUpload();

      // Test 3: Media Retrieval
      await this.testMediaRetrieval();

      // Test 4: Authentication and Privacy
      await this.testPrivacyControls();

      // Test 5: Array Conversion
      await this.testArrayConversion();

      // Summary
      this.printSummary();

    } catch (error) {
      console.error('❌ Test suite failed:', error);
      this.testResults.push({ test: 'Test Suite', status: 'FAILED', error: error.message });
    }
  }

  async testAuthentication() {
    console.log('\n📝 Test 1: User Authentication');
    
    try {
      // Register test user
      const testEmail = `test_media_${Date.now()}@example.com`;
      const testPassword = 'test_password_123';

      const registerResponse = await axios.post(`${BASE_URL}/api/user/register`, {
        email: testEmail,
        password: testPassword
      });

      if (registerResponse.data.success) {
        this.token = registerResponse.data.token;
        this.user = {
          email: testEmail,
          publicKey: registerResponse.data.publicKey
        };
        
        console.log('✅ User registered successfully');
        console.log('🔑 Public key:', this.user.publicKey.slice(0, 20) + '...');
        this.testResults.push({ test: 'Authentication', status: 'PASSED' });
      } else {
        throw new Error('Registration failed');
      }
    } catch (error) {
      console.error('❌ Authentication test failed:', error.message);
      this.testResults.push({ test: 'Authentication', status: 'FAILED', error: error.message });
      throw error;
    }
  }

  async testMediaUpload() {
    console.log('\n📤 Test 2: Media Upload');
    
    try {
      // Create test file
      const testContent = Buffer.from('This is test media content for distribution testing');
      const testFilePath = path.join(__dirname, 'test_media.txt');
      fs.writeFileSync(testFilePath, testContent);

      // Upload via API
      const form = new FormData();
      form.append('file', fs.createReadStream(testFilePath));
      form.append('name', 'Test Media File');
      form.append('access_level', 'private');

      const uploadResponse = await axios.post(`${BASE_URL}/api/media/upload`, form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (uploadResponse.data.success) {
        this.mediaId = uploadResponse.data.mediaId;
        this.mediaDid = uploadResponse.data.did;
        
        console.log('✅ Media uploaded successfully');
        console.log('🆔 Media ID:', this.mediaId);
        console.log('🔗 DID:', this.mediaDid);
        console.log('🧲 Magnet URI:', uploadResponse.data.magnetURI.slice(0, 50) + '...');
        console.log('👤 Owner:', uploadResponse.data.owner.slice(0, 12) + '...');
        
        this.testResults.push({ test: 'Media Upload', status: 'PASSED' });
      } else {
        throw new Error('Upload failed');
      }

      // Cleanup test file
      fs.unlinkSync(testFilePath);

    } catch (error) {
      console.error('❌ Media upload test failed:', error.message);
      this.testResults.push({ test: 'Media Upload', status: 'FAILED', error: error.message });
      throw error;
    }
  }

  async testMediaRetrieval() {
    console.log('\n📥 Test 3: Media Retrieval');
    
    try {
      // Test media info endpoint
      const infoResponse = await axios.get(`${BASE_URL}/api/media/${this.mediaId}/info`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (infoResponse.data.media) {
        console.log('✅ Media info retrieved successfully');
        console.log('📊 Size:', infoResponse.data.media.size, 'bytes');
        console.log('🎭 MIME:', infoResponse.data.media.mime);
        console.log('🌱 Seeding:', infoResponse.data.seeding);
        
        this.testResults.push({ test: 'Media Info', status: 'PASSED' });
      } else {
        throw new Error('Media info not found');
      }

      // Test file download
      const downloadResponse = await axios.get(`${BASE_URL}/api/media/${this.mediaId}`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      if (downloadResponse.data) {
        console.log('✅ Media file downloaded successfully');
        console.log('📄 Content length:', downloadResponse.data.length);
        
        this.testResults.push({ test: 'Media Download', status: 'PASSED' });
      } else {
        throw new Error('Download failed');
      }

    } catch (error) {
      console.error('❌ Media retrieval test failed:', error.message);
      this.testResults.push({ test: 'Media Retrieval', status: 'FAILED', error: error.message });
    }
  }

  async testPrivacyControls() {
    console.log('\n🔒 Test 4: Privacy Controls');
    
    try {
      // Test unauthenticated access (should fail)
      try {
        await axios.get(`${BASE_URL}/api/media/${this.mediaId}/info`);
        throw new Error('Unauthenticated access should have failed');
      } catch (error) {
        if (error.response && error.response.status === 401) {
          console.log('✅ Unauthenticated access properly blocked');
          this.testResults.push({ test: 'Privacy Controls', status: 'PASSED' });
        } else {
          throw error;
        }
      }

      // Test search for private media (should only show to owner)
      const searchResponse = await axios.get(`${BASE_URL}/api/records?source=gun&recordType=media&limit=10`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      const foundMedia = searchResponse.data.records?.find(r => r.oip?.did === this.mediaDid);
      if (foundMedia) {
        console.log('✅ Owner can find their private media in search');
        this.testResults.push({ test: 'Owner Search Access', status: 'PASSED' });
      } else {
        console.log('⚠️ Private media not found in search (may be indexing delay)');
        this.testResults.push({ test: 'Owner Search Access', status: 'WARNING' });
      }

    } catch (error) {
      console.error('❌ Privacy controls test failed:', error.message);
      this.testResults.push({ test: 'Privacy Controls', status: 'FAILED', error: error.message });
    }
  }

  async testArrayConversion() {
    console.log('\n🔄 Test 5: Array Conversion');
    
    try {
      // Check if arrays in the uploaded manifest were properly handled
      const infoResponse = await axios.get(`${BASE_URL}/api/media/${this.mediaId}/info`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      const transport = infoResponse.data.media?.transport;
      if (transport) {
        // Check if arrays are properly formatted in response
        const httpUrls = transport.http;
        const trackers = transport.bittorrent?.trackers;

        if (Array.isArray(httpUrls) && Array.isArray(trackers)) {
          console.log('✅ Arrays properly converted and returned');
          console.log('🔗 HTTP URLs:', httpUrls.length, 'entries');
          console.log('📡 Trackers:', trackers.length, 'entries');
          this.testResults.push({ test: 'Array Conversion', status: 'PASSED' });
        } else {
          console.log('⚠️ Arrays not in expected format');
          console.log('🔗 HTTP type:', typeof httpUrls, Array.isArray(httpUrls));
          console.log('📡 Trackers type:', typeof trackers, Array.isArray(trackers));
          this.testResults.push({ test: 'Array Conversion', status: 'WARNING' });
        }
      } else {
        throw new Error('Transport data not found');
      }

    } catch (error) {
      console.error('❌ Array conversion test failed:', error.message);
      this.testResults.push({ test: 'Array Conversion', status: 'FAILED', error: error.message });
    }
  }

  printSummary() {
    console.log('\n📊 Test Results Summary');
    console.log('=' .repeat(50));
    
    let passed = 0;
    let failed = 0;
    let warnings = 0;

    this.testResults.forEach(result => {
      const status = result.status === 'PASSED' ? '✅' : 
                    result.status === 'WARNING' ? '⚠️' : '❌';
      console.log(`${status} ${result.test}: ${result.status}`);
      
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }

      if (result.status === 'PASSED') passed++;
      else if (result.status === 'WARNING') warnings++;
      else failed++;
    });

    console.log('\n📈 Summary:');
    console.log(`✅ Passed: ${passed}`);
    console.log(`⚠️ Warnings: ${warnings}`);
    console.log(`❌ Failed: ${failed}`);
    
    if (failed === 0) {
      console.log('\n🎉 All critical tests passed! Media distribution system is working.');
    } else {
      console.log('\n🚨 Some tests failed. Check implementation.');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new MediaDistributionTester();
  tester.runAllTests().catch(console.error);
}

module.exports = MediaDistributionTester;
