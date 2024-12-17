# OIP Arweave Indexer

This project provides an API to index and interact with records stored on the Arweave blockchain according to the OIP (Open Index Protocol) specification, with data remapped to fit various templates also stored in Arweave. The indexer periodically checks Arweave for new records and templates and updates the local Elasticsearch database, enabling fast and efficient querying.

## Features

- **Blockchain indexing**: Indexes Arweave transactions with the "IndexingSpec": "OIP" tag.
- **Elasticsearch integration**: Manages records with Elasticsearch.
- **API Endpoints**: Provides endpoints to interact with records, creators, and templates.
- **Embedded records**: Supports nested records, allowing media to be published once and referenced in multiple records.

## Installation

### Prerequisites

- Docker & Docker Compose
- Node.js (version 16 or higher if running locally without Docker)

- ### Installing `canvas` Dependency

The `canvas` module is required for certain functionalities, such as rendering or processing images. To use it, ensure the necessary system libraries are installed.

#### Canvas Installation Steps

1. **Install the `canvas` module**:  
Run the following command to install the `canvas` module:
   ```bash
   npm install canvas
   ```

2.	**System Dependencies**:
Depending on your operating system, install the necessary system-level libraries:
	•	Ubuntu/Debian:
    `sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev`

    •	Fedora:
    `sudo yum install gcc-c++ cairo-devel pango-devel libjpeg-turbo-devel giflib-devel`

    •	macOS:
Install the libraries using Homebrew:
    `brew install pkg-config cairo pango libpng jpeg giflib librsvg`

    •	Windows:
Follow the instructions provided in the node-canvas Wiki for Windows setup.

3.	**Rebuild Native Bindings (if required)**:
After installing system dependencies, rebuild the canvas bindings:
`npm rebuild canvas`

4.	**Verify Installation**:
Run the following code snippet to ensure the canvas module works correctly:
    ```
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'green';
    ctx.fillRect(10, 10, 150, 100);
    console.log('Canvas module is working correctly');
    ```

If you encounter issues during installation or runtime, refer to the node-canvas installation guide for detailed troubleshooting steps.

### Setting Up Environment Variables

To run the application, ensure you have an `.env` file in the project root that looks like this:

```
WALLET_FILE=config/arweave-keyfile.json
PORT=3005
ELASTICSEARCHHOST=http://elasticsearch:9200
ELASTICCLIENTUSERNAME=elastic
ELASTICCLIENTPASSWORD=tVUsFYYXexZshWT3Jbhx
OPENAI_API_KEY=
TWITTER_BEARER_TOKEN=
```

#### Arweave Keyfile Setup

1. Follow [this guide](https://docs.arweave.org/developers/wallets/arweave-wallet) to create a new Arweave keyfile using [Arweave.app](https://arweave.app).
2. After creating the keyfile, click the **Backup Keyfile** button and store it as `config/arweave-keyfile.json` as the `.env` expects.

#### Elasticsearch Credentials

If you change the Elasticsearch username and password, update the `.env` file **and** `docker-compose.yml` like this:

```
yaml
environment:
  - NODE_ENV=production
  - ELASTICSEARCH_HOST=http://elasticsearch:9200
  - ELASTICCLIENTUSERNAME=elastic
  - ELASTICCLIENTPASSWORD=your-new-password
```

#### Scrape Route Configuration

To use the /scrape route, you must provide both:

	•	OPENAI_API_KEY
	•	TWITTER_BEARER_TOKEN

These keys are required to access OpenAI and Twitter services used by the scrape route.

### Docker Setup

1. **Build and start the services**:

    ```bash
    docker-compose up --build
    ```
    
    This will spin up the application, Elasticsearch, Kibana, and IPFS in a Docker network.

2. **Stop services**:

    ```bash
    docker-compose down
    ```

##API Endpoints

1. Records Endpoints

	•	/api/records/newRecord: Create a new record and publish it in the blockchain.
	
	•	/api/records: Fetch records that have been indexed in the blockchain and saved into the local elasticsearch database.

2. Creators Endpoints

	•	/api/creators: Manage creator data, including querying records by creator or adding new creator information.

3. Templates Endpoints

	•	/api/templates: Define and retrieve templates associated with records, used for standardizing metadata formats.

4. Scrape Endpoint

	•	/api/scrape: Scrape articles from the web and archive them onto the permaweb.

5. Health Endpoint

	•	/api/health: Provides a basic health check for the API and server status.

### Records	    
### newRecord

Create a new record. 

`POST /api/records/newRecord`

Body:

```
{
  "record": {
    "creatorRegistration": {
      "handle": "creatorHandle",
      "surname": "Doe"
    },
    "basic": {
      "name": "Sample Record"
    }
  }
}
```
Query Parameters:

	•	recordType - Required, must be the name of one of the templates used in the record.

The `newRecord` endpoint allows embedding records inside other records. This can be used to reference a piece of media multiple times without duplicating metadata.

#### Example POST to `/api/records/newRecord?recordType=post`
body:

```
{
    "basic": {
        "name": "Fmr. AG Barr Says Far-Left Greater Threat To Country Than Trump",
        "language": "En",
        "date": 1713783811,
        "description": "It is a heavy-handed bunch of thugs ... that’s where the threat is",
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
    }
}
```

#### Compressed Reference Based Records in Blockchain
On the Arweave blockchain, this record will be stored like this:

```
[
  {
    "0": "Fmr. AG Barr Says Far-Left Greater Threat To Country Than Trump",
    "1": "'It is a heavy-handed bunch of thugs ... that’s where the threat is'",
    "2": 1713783811,
    "3": 37,
    "6": false,
    "8": [
      "donald-trump",
      "bill-barr"
    ],
    "10": [
      "did:arweave:4wM6oEEMTvMzOHdqj8qur5alN_AQz0pq73Z8BdNcaoE"
    ],
    "t": "FqFcGi1eVb4iSwzVihsZi8tcDwQ73wAMNwF3WrPyKFc"
  },
  {
    "0": "Chris Bertman",
    "1": null,
    "2": null,
    "3": "did:arweave:bK0id2osDDR4_6qJfuNcpqbVtdbhSsLXfY8Qm9d9L-Q",
    "4": "did:arweave:5D40mYttXurPwL2kKBrlCrMA8kajMUTAtnD3TRU8kYg",
    "t": "Bng-cS49UYxDicfiD5zLqOclFogyqSwSOyczHng3dgM"
  },
  {
    "0": "https://scnr.com/content/f06bfaec-005c-11ef-9c93-0242ac1c0002",
    "t": "6AiFwK-2g8HgrRU6zSZYup32rz1aEAcppFsewGdig7Y"
  }
]
```

with the tags:

```
Content-Type: application/json
Index-Method: OIP
Ver: 0.7.2
Type: Record
RecordType: post
Creator: u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0
CreatorSig: pYRF5mNPiHknHh3senyXV3GmVNtQwpmhMOS3w8JdmFJYgKmuycveeGwSs+cDMgyFk9Yj8QGkBdytKg2NYfDZxzVOVknaa0fy2pMK72cgYQMcb5tSyiDV041+h/9+74oauCGyUrzskqeaECzoFlqx8G/enzua1uUwFdQS79DoHBo4/EbiiCVvB5HH43PG19Rq5EpV7HT1W3XDLdkoMfF+gtuLF8SWHwENdArZ166ks/a5OQUqVkra9zfK46OctSqhWg5SO3SUWKE/+sKp5uCPczX0/DmYwAahRw3DSVe+gtN3RR/bHuMbT1A7myqsjYuYOVD30rGOIhLA/BQ+xei4sncW1Sza8j3ypRERdfWQav9WDkcgkYnZoOpAaz/ETg5FOHuCLdIyUySK8lb0CodbSHZFSaAG6Q6qbMZzvujsq/0XvbKpgNWOc72w69fGH0Qof82u4AAqBbaf9++XFjeALZhiuC4ex3O9jj4Axzw1nhrUI7bst7awNQDSj3iK+Y+KRR54a9WIgqrYA3yLhRzZ1m1MT/lc1GWfAdUSonel2k6tQffDiy7zYZ4v/ujjZEE9SY07usJsKuPLppr+9eh9wSKQW34N6RoVE+x4gJ8uBjj17PWojXbAEBoLEB4piEEfEF8FdreqcKo0q0HqVwa/G41z5gJnypsK33yFBZAMj2Q=
```

### getRecords

`/api/records`

Newly published records are periodically retrieved from the blockchain and expanded back into full JSON objects when they get stored in the local elasticsearch database, as shown below. 

```
{
    "data": [
        {
            "basic": {
                "name": "Fmr. AG Barr Says Far-Left Greater Threat To Country Than Trump",
                "description": "'It is a heavy-handed bunch of thugs ... that’s where the threat is'",
                "date": 1713783811,
                "language": "English",
                "tagItems": [
                    "donald-trump",
                    "bill-barr"
                ],
                "urlItems": [
                    "did:arweave:4wM6oEEMTvMzOHdqj8qur5alN_AQz0pq73Z8BdNcaoE"
                ]
            }
        },
        {
            "post": {
                "bylineWriter": "Chris Bertman",
                "articleText": "did:arweave:bK0id2osDDR4_6qJfuNcpqbVtdbhSsLXfY8Qm9d9L-Q",
                "featuredImage": "did:arweave:5D40mYttXurPwL2kKBrlCrMA8kajMUTAtnD3TRU8kYg"
            }
        }
    ]
}
```

Note that a number of the fields have values that start with `did:arweave:`, these are DID references to other records, embedding them into the top level record without redundant record data.

####Resolving DID references to embedded records

Adding `resolveDepth=2`, you can resolve embedded records:

```
{
    "data": [
        {
            "basic": {
                "name": "Fmr. AG Barr Says Far-Left Greater Threat To Country Than Trump",
                "description": "It is a heavy-handed bunch of thugs ... that’s where the threat is",
                "date": 1713783811,
                "language": "English",
                "nsfw": false,
                "tagItems": ["donald-trump", "bill-barr"],
                "urlItems": [
                    {
                        "associatedURLOnWeb": {
                            "url": "https://scnr.com/content/f06bfaec-005c-11ef-9c93-0242ac1c0002"
                        }
                    }
                ]
            }
        },
        {
            "post": {
                "bylineWriter": "Chris Bertman",
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
                        "language": "English",
                        "nsfw": false
                    },
                    "image": {
                        "height": 409,
                        "width": 720,
                        "size": 510352,
                        "contentType": "image/x-png"
                    }
                }
            }
        }
    ]
}
```

####Sorting Records

This endpoint also supports sorting, by using the query param **sortBy** and specifying various fields from the record's OIP metadata, as well as asc or desc, like:

`/api/records?sortBy=inArweaveBlock:asc`

####Filtering Records

It also supports optional filters of OIP metadata like template, creatorHandle, txid, didTx.

Example query:

`/api/records?resolveDepth=2&sortBy=inArweaveBlock:asc&creatorHandle=Player6&template=post`

## Creators

### GetCreators

Fetch all registered creators.

`GET /api/creators`

## Templates

### GetTemplates

Fetch all templates stored in the database.

Example query:
`GET /api/templates`

### NewTemplate

POST /api/templates/newTemplate

Create a new template.

Body

```
{
  "name": "Sample Template",
  "fields": {
    "field1": "string",
    "field2": "enum"
  }
}
```

### Scrape

* Do not attempt to use this endpoint unless you have filled in your twitter and open ai api keys in your .env:

```
OPENAI_API_KEY=YOUROPENAIAPIKEY
TWITTER_BEARER_TOKEN=YOURTWITTERBEARERTOKEN
```
#### Get Article

`GET api/scrape/article/stream`

Query Params:

```
url
```

#### Summarize Articles

`POST api/scrape/articles/summary`

Body:

```
articles
```

### Health

`GET /api/health`

Responds with status code 200 and the string `status: 'OK'` if OIPArweave is running properly 
