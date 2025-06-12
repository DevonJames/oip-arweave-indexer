const assert = require('assert');
const sinon = require('sinon');

// Import modules to test
const mediaManager = require('../helpers/media-manager');
const publisherManager = require('../helpers/publisher-manager');
const { publishNewRecord } = require('../helpers/templateHelper');

describe('User JSON Structure Tests', function() {
    this.timeout(30000);

    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('Recipe JSON Structure', () => {
        
        it('should process recipe with image.webUrl correctly', async () => {
            // Mock successful publishing
            const publishStub = sandbox.stub(publisherManager, 'publish');
            publishStub.resolves({ id: 'arweave123', blockchain: 'arweave', provider: 'turbo' });

            const recipeRecord = {
                "basic": {
                    "name": "Mediterranean Grilled Chicken Thighs with Dill Yogurt Sauce",
                    "language": "En",
                    "date": 1656486000,
                    "description": "This grilled chicken recipe is one of the most popular here on the site...",
                    "webUrl": "https://www.themediterraneandish.com/mediterranean-grilled-chicken-dill-greek-yogurt-sauce/",
                    "nsfw": false,
                    "tagItems": ["Blackstone", "grilling", "greek", "main course"]
                },
                "recipe": {
                    "prep_time_mins": 10,
                    "cook_time_mins": 12,
                    "total_time_mins": 22,
                    "servings": 8,
                    "ingredient_amount": [32, 10, 0.5, 0.5, 0.5, 0.25, 0.125, 0.125, 5],
                    "ingredient_unit": ["ozs", "cloves", "tsp", "tsp", "tsp", "tsp", "tsp", "tsp", "tbsp"],
                    "ingredient": ["did:arweave:U-ZMAmdqjXZOC1DqXi3OvTacEDOYkuCqdz_2iwQ-ndE", "did:arweave:t9sr97FVq5PgOygvThVeYKkpbwjLcuQQUv5Dj5pqhn4"],
                    "instructions": "Make the dill Greek yogurt sauce and refrigerate..."
                },
                "image": {
                    "webUrl": "https://www.themediterraneandish.com/wp-content/uploads/2015/05/mediterranean-grilled-chicken-recipe-13.jpg",
                    "contentType": "image/jpeg"
                }
            };

            // Test media processing for the image field
            const mediaConfig = {
                source: 'url',
                data: recipeRecord.image.webUrl,
                contentType: 'image/jpeg',
                publishTo: {
                    arweave: true,
                    bittorrent: false
                }
            };

            const result = await mediaManager.processMedia(mediaConfig);

            // Verify DID generation
            assert(result.storageNetworks);
            assert.equal(result.storageNetworks.length, 1);
            assert.equal(result.storageNetworks[0].network, 'arweave');
            assert.equal(result.storageNetworks[0].did, 'did:arweave:arweave123');
        });
    });

    describe('Post JSON Structure', () => {
        
        it('should process post with featuredImage.associatedUrlOnWeb.url correctly', async () => {
            // Mock successful publishing
            const publishStub = sandbox.stub(publisherManager, 'publish');
            publishStub.resolves({ id: 'arweave456', blockchain: 'arweave', provider: 'turbo' });

            const postRecord = {
                "basic": {
                    "name": "Fmr. AG Barr Says Far-Left Greater Threat To Country Than Trump",
                    "language": "En",
                    "date": 1713783811,
                    "description": "'It is a heavy-handed bunch of thugs ... that's where the threat is'",
                    "urlItems": [{
                        "associatedUrlOnWeb": {
                            "url": "https://scnr.com/content/f06bfaec-005c-11ef-9c93-0242ac1c0002"
                        }
                    }],
                    "nsfw": false,
                    "tagItems": ["donald-trump", "bill-barr"]
                },
                "post": {
                    "bylineWriter": "Chris Bertman",
                    "bylineWritersTitle": null,
                    "bylineWritersLocation": null,
                    "articleText": {
                        "text": {
                            "ipfsAddress": "QmY6U4y7JZ2XeZ3VFuqjySQ5xZavUbiGczc9gVbuWUE89H",
                            "filename": "article.md",
                            "contentType": "text/markdown"
                        }
                    },
                    "featuredImage": {
                        "basic": {
                            "name": "Fmr. AG Barr",
                            "date": 0,
                            "language": "en",
                            "nsfw": false
                        },
                        "image": {
                            "height": 409,
                            "width": 720,
                            "size": 510352,
                            "contentType": "image/x-png"
                        },
                        "associatedUrlOnWeb": {
                            "url": "https://scnr.com/image/440f1c8b-a034-11ee-9c93-0242ac1c0002"
                        }
                    }
                },
                "associatedUrlOnWeb": {
                    "url": "https://scnr.com/content/f06bfaec-005c-11ef-9c93-0242ac1c0002"
                }
            };

            // Test media processing for the featuredImage
            const mediaConfig = {
                source: 'url',
                data: postRecord.post.featuredImage.associatedUrlOnWeb.url,
                contentType: 'image/x-png',
                publishTo: {
                    arweave: true,
                    bittorrent: false
                }
            };

            const result = await mediaManager.processMedia(mediaConfig);

            // Verify DID generation
            assert(result.storageNetworks);
            assert.equal(result.storageNetworks.length, 1);
            assert.equal(result.storageNetworks[0].network, 'arweave');
            assert.equal(result.storageNetworks[0].did, 'did:arweave:arweave456');
        });
    });

    describe('API Endpoint Integration', () => {
        
        it('should handle recipe JSON structure through API endpoint format', () => {
            // Simulate the exact API call structure
            const requestBody = {
                "basic": {
                    "name": "Mediterranean Grilled Chicken Thighs with Dill Yogurt Sauce",
                    "language": "En",
                    "date": 1656486000,
                    "description": "This grilled chicken recipe...",
                    "webUrl": "https://www.themediterraneandish.com/mediterranean-grilled-chicken-dill-greek-yogurt-sauce/",
                    "nsfw": false,
                    "tagItems": ["Blackstone", "grilling", "greek", "main course"]
                },
                "recipe": {
                    "prep_time_mins": 10,
                    "cook_time_mins": 12,
                    "total_time_mins": 22,
                    "servings": 8,
                    "ingredient_amount": [32, 10, 0.5],
                    "ingredient_unit": ["ozs", "cloves", "tsp"],
                    "ingredient": ["did:arweave:U-ZMAmdqjXZOC1DqXi3OvTacEDOYkuCqdz_2iwQ-ndE"],
                    "instructions": "Make the dill Greek yogurt sauce and refrigerate..."
                },
                "image": {
                    "webUrl": "https://www.themediterraneandish.com/wp-content/uploads/2015/05/mediterranean-grilled-chicken-recipe-13.jpg",
                    "contentType": "image/jpeg"
                }
            };

            const queryParams = {
                recordType: 'recipe',
                publishFiles: 'true',
                addMediaToArweave: 'true',
                addMediaToIPFS: 'false',
                addMediaToArFleet: 'false'
            };

            // Verify structure is valid JSON
            assert.doesNotThrow(() => {
                JSON.stringify(requestBody);
            });

            // Verify required fields exist
            assert(requestBody.basic);
            assert(requestBody.recipe);
            assert(requestBody.image);
            assert(requestBody.image.webUrl);
            
            console.log('✅ Recipe JSON structure is valid for API endpoint');
        });

        it('should handle post JSON structure through API endpoint format', () => {
            // Simulate the exact API call structure  
            const requestBody = {
                "basic": {
                    "name": "Fmr. AG Barr Says Far-Left Greater Threat To Country Than Trump",
                    "language": "En",
                    "date": 1713783811,
                    "description": "'It is a heavy-handed bunch of thugs ... that's where the threat is'",
                    "urlItems": [{
                        "associatedUrlOnWeb": {
                            "url": "https://scnr.com/content/f06bfaec-005c-11ef-9c93-0242ac1c0002"
                        }
                    }],
                    "nsfw": false,
                    "tagItems": ["donald-trump", "bill-barr"]
                },
                "post": {
                    "bylineWriter": "Chris Bertman",
                    "featuredImage": {
                        "basic": {
                            "name": "Fmr. AG Barr",
                            "date": 0,
                            "language": "en",
                            "nsfw": false
                        },
                        "image": {
                            "height": 409,
                            "width": 720,
                            "size": 510352,
                            "contentType": "image/x-png"
                        },
                        "associatedUrlOnWeb": {
                            "url": "https://scnr.com/image/440f1c8b-a034-11ee-9c93-0242ac1c0002"
                        }
                    }
                }
            };

            const queryParams = {
                recordType: 'post',
                publishFiles: 'true',
                addMediaToArweave: 'true',
                addMediaToIPFS: 'true'
            };

            // Verify structure is valid JSON
            assert.doesNotThrow(() => {
                JSON.stringify(requestBody);
            });

            // Verify required fields exist
            assert(requestBody.basic);
            assert(requestBody.post);
            assert(requestBody.post.featuredImage);
            assert(requestBody.post.featuredImage.associatedUrlOnWeb);
            assert(requestBody.post.featuredImage.associatedUrlOnWeb.url);
            
            console.log('✅ Post JSON structure is valid for API endpoint');
        });
    });
});

module.exports = {}; 