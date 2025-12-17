# OIP v0.9.0 Implementation Plan

## Executive Summary

This document provides a comprehensive implementation plan for OIP v0.9.0, covering the migration from Arweave-based signatures to DID-based identity verification. It includes documentation of the existing Phase 0 implementation (core signing workflow) and the roadmap for completing the full specification.

---

## Table of Contents

1. [Phase 0: Core Signing Workflow (Complete)](#phase-0-core-signing-workflow-complete)
2. [Phase 1: HD Key Derivation Infrastructure](#phase-1-hd-key-derivation-infrastructure)
3. [Phase 2: Signature Verification Service](#phase-2-signature-verification-service)
4. [Phase 3: DID Document Templates](#phase-3-did-document-templates)
5. [Phase 4: DID Resolution Service](#phase-4-did-resolution-service)
6. [Phase 5: Creator Identity Workflow](#phase-5-creator-identity-workflow)
7. [Phase 6: Migration & Backward Compatibility](#phase-6-migration--backward-compatibility)
8. [Phase 7: Integration with OIP Indexer](#phase-7-integration-with-oip-indexer)
9. [Implementation Timeline](#implementation-timeline)
10. [Testing Strategy](#testing-strategy)
11. [Appendix: v0.9.0 Template Schemas](#appendix-v090-template-schemas)

---

## Phase 0: Core Signing Workflow (Complete)

Phase 0 establishes the foundational signing infrastructure. This phase is **complete** and implemented in `OIP/TestBench` and `OIP/IT.WebServices.OIP`.

### 0.1 Project Structure

```
OIP/
├── IT.WebServices.OIP/
│   ├── IT.WebServices.OIP.csproj
│   ├── Models/
│   │   ├── DataForSignature.cs
│   │   ├── DataTagNvPair.cs
│   │   ├── DidFragments.cs
│   │   └── RecordTemplates/
│   │       ├── IRecordTemplate.cs
│   │       ├── BasicRecordTemplate.cs
│   │       ├── CreatorRegistrationRecordTemplate.cs
│   │       ├── ImageRecordTemplate.cs
│   │       └── PostRecordTemplate.cs
│   └── Services/
│       └── SigningService.cs
└── TestBench/
    ├── TestBench.csproj
    ├── Program.cs
    ├── TestSampleCreator.cs
    └── TestSamplePost.cs
```

### 0.2 Core Models

#### DataForSignature.cs
The top-level container for all data to be signed and published.

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models
{
    public class DataForSignature
    {
        [JsonPropertyName("@context")]
        [JsonPropertyOrder(1)]
        public string Context { get; set; } = "did:arweave:not_added_yet";

        [JsonPropertyName("id")]
        [JsonPropertyOrder(2)]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Id { get; set; }

        [JsonPropertyName("tags")]
        [JsonPropertyOrder(3)]
        public List<DataTagNvPair> Tags { get; set; } = [
            DataTagNvPair.INDEX_METHOD, 
            DataTagNvPair.VERSION, 
            DataTagNvPair.CONTENT_TYPE
        ];

        [JsonPropertyName("fragments")]
        [JsonPropertyOrder(4)]
        public List<DidFragments> Fragments { get; set; } = new();
    }
}
```

#### DataTagNvPair.cs
Name-value pairs for OIP tags including standard constants.

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models
{
    public class DataTagNvPair
    {
        public const string CREATOR = "Creator";
        public const string CREATOR_SIGNATURE = "CreatorSig";
        
        public static readonly DataTagNvPair INDEX_METHOD = new() { Name = "Index-Method", Value = "OIP" };
        public static readonly DataTagNvPair VERSION = new() { Name = "Ver", Value = "0.9.0" };
        public static readonly DataTagNvPair CONTENT_TYPE = new() { Name = "Content-Type", Value = "application/json" };

        [JsonPropertyName("name")]
        [JsonPropertyOrder(1)]
        public string Name { get; set; } = "";

        [JsonPropertyName("value")]
        [JsonPropertyOrder(2)]
        public string Value { get; set; } = "";
    }
}
```

#### DidFragments.cs
Container for individual record fragments within a payload.

```csharp
using IT.WebServices.OIP.Models.RecordTemplates;
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models
{
    public class DidFragments
    {
        [JsonPropertyName("id")]
        [JsonPropertyOrder(1)]
        public string Id { get; set; } = "";

        [JsonPropertyName("dataType")]
        [JsonPropertyOrder(2)]
        public string DataType { get; set; } = "";

        [JsonPropertyName("recordType")]
        [JsonPropertyOrder(3)]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? RecordType { get; set; }

        [JsonPropertyName("records")]
        [JsonPropertyOrder(4)]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<IRecordTemplate>? Records { get; set; } = new(8);
    }
}
```

#### IRecordTemplate.cs
Base class for all record templates with polymorphic JSON serialization.

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    [JsonDerivedType(typeof(BasicRecordTemplate))]
    [JsonDerivedType(typeof(CreatorRegistrationRecordTemplate))]
    [JsonDerivedType(typeof(ImageRecordTemplate))]
    [JsonDerivedType(typeof(PostRecordTemplate))]
    public abstract class IRecordTemplate
    {
        [JsonIgnore]
        public abstract string Template { get; }
    }
}
```

### 0.3 Record Templates

#### BasicRecordTemplate.cs
Common metadata template used by most record types.

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    public class BasicRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:-9DirnjVO1FlbEW1lN8jITBESrTsQKEM_BoZ1ey_0mk";

        [JsonPropertyName("0")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Name { get; set; }

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Description { get; set; }

        [JsonIgnore]
        public DateTimeOffset? Date { get; set; }
        
        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public long? DateJson => Date?.ToUnixTimeSeconds();

        [JsonPropertyName("3")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public int? Language { get; set; }

        [JsonPropertyName("4")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Avatar { get; set; }

        [JsonPropertyName("5")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? License { get; set; }

        [JsonPropertyName("6")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? NSFW { get; set; }

        [JsonPropertyName("7")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? CreatorItems { get; set; }

        [JsonPropertyName("8")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? TagItems { get; set; }

        [JsonPropertyName("9")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? NoteItems { get; set; }

        [JsonPropertyName("10")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? UrlItems { get; set; }

        [JsonPropertyName("11")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Citations { get; set; }

        [JsonPropertyName("12")]
        public string? WebUrl { get; set; }
    }
}
```

#### CreatorRegistrationRecordTemplate.cs
Legacy creator identity template (v0.9.0 format).

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    public class CreatorRegistrationRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:not-added-yet";

        [JsonPropertyName("0")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Handle { get; set; }

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Surname { get; set; }

        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? SigningXpub { get; set; }

        [JsonPropertyName("3")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? DelegationXpub { get; set; }

        [JsonPropertyName("4")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? RevocationList { get; set; }
    }
}
```

#### ImageRecordTemplate.cs

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    public class ImageRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:AkZnE1VckJJlRamgNJuIGE7KrYwDcCciWOMrMh68V4o";

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? ArweaveAddress { get; set; }

        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? IPFSAddress { get; set; }

        [JsonPropertyName("3")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? BittorrentAddress { get; set; }

        [JsonPropertyName("4")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Filename { get; set; }

        [JsonPropertyName("5")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? ContentType { get; set; }

        [JsonPropertyName("6")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public ulong? Size { get; set; }

        [JsonPropertyName("7")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public ulong? Width { get; set; }

        [JsonPropertyName("8")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public ulong? Length { get; set; }

        [JsonPropertyName("9")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Creator { get; set; }
    }
}
```

#### PostRecordTemplate.cs

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    public class PostRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:op6y-d_6bqivJ2a2oWQnbylD4X_LH6eQyR6rCGqtVZ8";

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? BylineWriter { get; set; }

        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? BylineWritersTitle { get; set; }

        [JsonPropertyName("3")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? BylineWritersLocation { get; set; }

        [JsonPropertyName("4")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? ArticleText { get; set; }

        [JsonPropertyName("5")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? FeaturedImage { get; set; }

        [JsonPropertyName("6")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? ImageItems { get; set; }

        [JsonPropertyName("7")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? ImageCaptionItems { get; set; }

        [JsonPropertyName("8")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? VideoItems { get; set; }

        [JsonPropertyName("9")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? AudioItems { get; set; }

        [JsonPropertyName("10")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? AudioCaptionItems { get; set; }

        [JsonPropertyName("11")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? ReplyTo { get; set; }
    }
}
```

### 0.4 Signing Service

#### SigningService.cs
Implements the OIP v0.9.0 signature algorithm.

```csharp
using IT.WebServices.Crypto;
using IT.WebServices.OIP.Models;
using Microsoft.IdentityModel.Tokens;
using NBitcoin.Crypto;
using System.Text;
using System.Text.Json;

namespace IT.WebServices.OIP.Services
{
    public class SigningService
    {
        /// <summary>
        /// Adds a CreatorSig tag to the data after computing the signature.
        /// </summary>
        public static void AddSignatureTag(DataForSignature data, string signingJwk)
        {
            var signature = ComputeSignature(data, signingJwk);
            data.Tags.Add(new DataTagNvPair() 
            { 
                Name = DataTagNvPair.CREATOR_SIGNATURE, 
                Value = signature 
            });
        }

        /// <summary>
        /// Computes signature following OIP v0.9.0 algorithm:
        /// 1. Serialize to JSON
        /// 2. SHA256 hash
        /// 3. Sign with secp256k1 ECDSA
        /// 4. Base64URL encode
        /// </summary>
        public static string ComputeSignature(DataForSignature data, string signingJwk)
        {
            var json = JsonSerializer.Serialize(data);
            byte[] messageBytes = Encoding.UTF8.GetBytes(json);

            var signatureBytes = ComputeSignature(messageBytes, signingJwk);
            var signature = Base64UrlEncoder.Encode(signatureBytes);

            return signature;
        }

        /// <summary>
        /// Low-level signature computation from raw bytes.
        /// </summary>
        public static byte[] ComputeSignature(byte[] messageBytes, string signingJwk)
        {
            byte[] messageHash = Hashes.SHA256(messageBytes);
            var signatureBytes = signingJwk.DecodeJsonWebKeyToECDsa().SignHash(messageHash);
            return signatureBytes;
        }
    }
}
```

### 0.5 Crypto Extensions

#### JwkExtension.cs
JWK decoding and ECDSA key operations.

```csharp
using Microsoft.IdentityModel.Tokens;
using System.Security.Cryptography;

namespace IT.WebServices.Crypto
{
    public static class JwkExtension
    {
        public static JsonWebKey DecodeJsonWebKey(this string encodedJWK)
        {
            return new JsonWebKey(Base64UrlEncoder.Decode(encodedJWK));
        }

        public static ECDsa DecodeJsonWebKeyToECDsa(this string encodedJWK)
        {
            var jwk = encodedJWK.DecodeJsonWebKey();
            return jwk.ToECDsa();
        }

        public static ECDsa ToECDsa(this JsonWebKey jwk)
        {
            var ecParams = new ECParameters()
            {
                Curve = GetCurveByName(jwk.Crv),
                Q = new ECPoint(),
            };

            if (!string.IsNullOrWhiteSpace(jwk.D))
                ecParams.D = Base64UrlEncoder.DecodeBytes(jwk.D);

            if (!string.IsNullOrWhiteSpace(jwk.X))
                ecParams.Q.X = Base64UrlEncoder.DecodeBytes(jwk.X);
            if (!string.IsNullOrWhiteSpace(jwk.Y))
                ecParams.Q.Y = Base64UrlEncoder.DecodeBytes(jwk.Y);

            var ecdsa = ECDsa.Create(ecParams);
            return ecdsa;
        }

        private static ECCurve GetCurveByName(string curveName)
        {
            return curveName switch
            {
                JsonWebKeyECTypes.P256 => ECCurve.NamedCurves.nistP256,
                JsonWebKeyECTypes.P384 => ECCurve.NamedCurves.nistP384,
                JsonWebKeyECTypes.P521 => ECCurve.NamedCurves.nistP521,
                "secp256k1" => CustomCurves.SecP256k1Curve,
                _ => throw new NotImplementedException($"Curve not found: {curveName}")
            };
        }
    }
}
```

#### ExtPubKeyExtensions.cs
NBitcoin extended public key operations.

```csharp
using NBitcoin;
using System.Security.Cryptography;

namespace IT.WebServices.Crypto.Extra
{
    public static class ExtPubKeyExtensions
    {
        public static ExtPubKey FromXPub(this string xpubStr)
        {
            return ExtPubKey.Parse(xpubStr, Network.Main);
        }

        public static ECDsa ToECDsa(this PubKey pubKey, ECCurve curve)
        {
            var bytes = pubKey.Decompress().ToBytes();
            return ECDsa.Create(new ECParameters()
            {
                Curve = curve,
                Q = new()
                {
                    X = bytes.Skip(1).Take(32).ToArray(),
                    Y = bytes.Skip(33).Take(32).ToArray(),
                }
            });
        }

        public static string ToXPub(this ExtPubKey pubKey)
        {
            return pubKey.ToString(Network.Main);
        }
    }
}
```

### 0.6 TestBench Implementation

#### Program.cs

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace TestBench
{
    internal class Program
    {
        // Test signing JWK (secp256k1, Base64URL encoded)
        public const string TEST_SIGNING_JWK = "eyJhbGciOiJFUzI1NksiLCJjcnYiOiJzZWNwMjU2azEiLCJkIjoieFI3ZXlEenhTVXpPYllnWmxFUjFqbmkybjE0MkhxTFZHRDlhVF9qcXhJMCIsImt0eSI6IkVDIiwidXNlIjoic2lnIn0";
        
        // Corresponding xpub for verification
        public const string TEST_SIGNING_XPUB = "xpub6EVyMwjbyrQEwL5Xzt9ffaWdphw5AjUH2Y8dgZsnuvVQ8Bk6t62or1uTudxPYp99Zj9eao1vMopSXQUt7rR18fem1DbT5daw69RrruPJWnv";

        static async Task Main(string[] args)
        {
            var host = Host.CreateDefaultBuilder(args)
                .ConfigureServices((hostContext, services) =>
                {
                    services.AddTransient<TestSampleCreator>();
                    services.AddTransient<TestSamplePost>();
                })
                .Build();

            Console.WriteLine("\r\n\r\n------- Sample Creator ---------- \r\n");
            host.Services.GetRequiredService<TestSampleCreator>().Run();

            Console.WriteLine("\r\n\r\n------- Sample Post ---------- \r\n");
            host.Services.GetRequiredService<TestSamplePost>().Run();
        }
    }
}
```

#### TestSampleCreator.cs
Demonstrates creator registration with embedded avatar image.

```csharp
using IT.WebServices.OIP.Models;
using IT.WebServices.OIP.Models.RecordTemplates;
using IT.WebServices.OIP.Services;
using System.Text.Json;

namespace TestBench
{
    internal class TestSampleCreator
    {
        public void Run()
        {
            var creatorId = Guid.NewGuid();
            var imageId = Guid.NewGuid();

            // Basic metadata for creator
            var basicCreator = new BasicRecordTemplate()
            {
                Name = "test user",
                Description = "test description",
                Date = DateTimeOffset.UtcNow,
                Language = 37,
                NSFW = false,
                Avatar = "#" + imageId,  // Local reference to image fragment
                WebUrl = "https://invertedtech.org/test",
            };

            // Creator registration with signing xpub
            var creator = new CreatorRegistrationRecordTemplate()
            {
                Handle = "test",
                Surname = "McTester",
                SigningXpub = Program.TEST_SIGNING_XPUB,
            };

            // Basic metadata for avatar image
            var basicImage = new BasicRecordTemplate()
            {
                Name = "Unknown Person",
                Date = DateTimeOffset.UtcNow,
                NSFW = false,
            };

            // Image record
            var image = new ImageRecordTemplate()
            {
                ArweaveAddress = "did:arweave:YMokIpCziHygHQP67uyeIIsp5yL8BxYcBGzdq1Zu3Iw",
                Filename = "Unknown-person.gif",
                ContentType = "image/gif",
                Size = 1040,
                Width = 280,
                Length = 280,
                Creator = "#" + creatorId,  // Local reference back to creator
            };

            // Assemble payload
            var dataToSign = new DataForSignature();
            dataToSign.Tags.Add(new() { Name = DataTagNvPair.CREATOR, Value = "self" });
            dataToSign.Fragments.Add(new()
            {
                Id = creatorId.ToString(),
                DataType = "Record",
                RecordType = "creatorRegistration",
                Records = [basicCreator, creator],
            });
            dataToSign.Fragments.Add(new()
            {
                Id = imageId.ToString(),
                DataType = "Record",
                RecordType = "image",
                Records = [basicImage, image],
            });

            // Sign and output
            SigningService.AddSignatureTag(dataToSign, Program.TEST_SIGNING_JWK);
            var json = JsonSerializer.Serialize(dataToSign, new JsonSerializerOptions() { WriteIndented = true });

            Console.WriteLine(json);
        }
    }
}
```

#### TestSamplePost.cs
Demonstrates post record creation with existing creator reference.

```csharp
using IT.WebServices.OIP.Models;
using IT.WebServices.OIP.Models.RecordTemplates;
using IT.WebServices.OIP.Services;
using System.Text.Json;

namespace TestBench
{
    internal class TestSamplePost
    {
        public void Run()
        {
            var basic = new BasicRecordTemplate()
            {
                Name = "test post",
                Description = "test description",
                Date = DateTimeOffset.UtcNow,
                Language = 37,
                NSFW = false,
                WebUrl = "https://invertedtech.org/test",
            };

            var post = new PostRecordTemplate()
            {
                BylineWriter = "Me",
                BylineWritersTitle = "The Editor in Chief",
            };

            var dataToSign = new DataForSignature();
            // Reference existing creator by DID
            dataToSign.Tags.Add(new() { 
                Name = DataTagNvPair.CREATOR, 
                Value = "did:arweave:LNdPGMUKwLw8_SBfi324wQlnpgvzrFQpRhLyAlV4lGo" 
            });
            dataToSign.Fragments.Add(new()
            {
                Id = Guid.NewGuid().ToString(),
                DataType = "Record",
                RecordType = "post",
                Records = [basic, post],
            });

            SigningService.AddSignatureTag(dataToSign, Program.TEST_SIGNING_JWK);
            var json = JsonSerializer.Serialize(dataToSign, new JsonSerializerOptions() { WriteIndented = true });

            Console.WriteLine(json);
        }
    }
}
```

### 0.7 Signature Algorithm Specification

The OIP v0.9.0 signature algorithm (implemented in `SigningService`):

1. **Assemble** the document in `DataForSignature` with all records and tags (except `CreatorSig`)
2. **Serialize** to JSON text
3. **Hash** using SHA256
4. **Sign** the hash with secp256k1 ECDSA (RFC 8812 §3.2)
5. **Encode** the signature using Base64URL (RFC 4648 §5)
6. **Add** tag: `name: "CreatorSig"`, `value: base64url(signature)`

### 0.8 Sample Output

Running `TestSampleCreator` produces:

```json
{
  "@context": "did:arweave:not_added_yet",
  "tags": [
    { "name": "Index-Method", "value": "OIP" },
    { "name": "Ver", "value": "0.9.0" },
    { "name": "Content-Type", "value": "application/json" },
    { "name": "Creator", "value": "self" },
    { "name": "CreatorSig", "value": "MEUCIQDx...base64url..." }
  ],
  "fragments": [
    {
      "id": "guid-1",
      "dataType": "Record",
      "recordType": "creatorRegistration",
      "records": [
        { "t": "did:arweave:-9Dir...", "0": "test user", "1": "test description", ... },
        { "t": "did:arweave:not-added-yet", "0": "test", "1": "McTester", "2": "xpub6EVy..." }
      ]
    },
    {
      "id": "guid-2",
      "dataType": "Record",
      "recordType": "image",
      "records": [...]
    }
  ]
}
```

---

## Phase 1: HD Key Derivation Infrastructure

**Goal**: Implement SLIP-0043 derivation paths for OIP identity keys.

### 1.1 Key Derivation Constants

Create `IT.WebServices.OIP/Crypto/OipKeyDerivation.cs`:

```csharp
using NBitcoin;
using System.Security.Cryptography;
using System.Text;

namespace IT.WebServices.OIP.Crypto
{
    public static class OipKeyDerivation
    {
        /// <summary>
        /// OIP custom purpose under SLIP-0043
        /// </summary>
        public const uint OIP_PURPOSE = 176800;
        
        /// <summary>
        /// Sub-purpose indices for different key uses
        /// </summary>
        public enum SubPurpose : uint
        {
            IdentitySign = 0,      // DID assertion/authentication keys
            IdentityEncrypt = 1,   // DID keyAgreement (x25519)
            Delegation = 2,        // Delegate capability keys
            Revocation = 3,        // Revoke/expire other keys
            Jwt = 4,               // App/API tokens
            Ssh = 5,               // SSH login keys
            Backup = 6,            // Rolling backup encryption
            Onion = 7,             // Tor onion service identity
            Experimental = 8       // Future expansion
        }
        
        /// <summary>
        /// Builds derivation path: m / 176800' / sub-purpose' / account' / index[']
        /// </summary>
        public static KeyPath GetDerivationPath(SubPurpose subPurpose, uint account, uint index, bool hardened = false)
        {
            var path = $"m/{OIP_PURPOSE}'/{(uint)subPurpose}'/{account}'";
            path += hardened ? $"/{index}'" : $"/{index}";
            return KeyPath.Parse(path);
        }
        
        /// <summary>
        /// Gets the xpub derivation base path: m / 176800' / sub-purpose' / account'
        /// This is the path at which the xpub is published in creator records.
        /// </summary>
        public static KeyPath GetXpubBasePath(SubPurpose subPurpose, uint account)
        {
            return KeyPath.Parse($"m/{OIP_PURPOSE}'/{(uint)subPurpose}'/{account}'");
        }
        
        /// <summary>
        /// Derives index from txId per OIP spec: uint31(SHA256("oip:" + txId))
        /// </summary>
        public static uint DeriveIndexFromTxId(string txId)
        {
            var input = $"oip:{txId}";
            var hash = SHA256.HashData(Encoding.UTF8.GetBytes(input));
            // Take first 4 bytes as uint32, mask to uint31 (clear high bit)
            return BitConverter.ToUInt32(hash, 0) & 0x7FFFFFFF;
        }
        
        /// <summary>
        /// Derives a child key for signing a specific record.
        /// </summary>
        public static ExtKey DeriveSigningKey(ExtKey masterKey, uint account, string txId)
        {
            var basePath = GetXpubBasePath(SubPurpose.IdentitySign, account);
            var baseKey = masterKey.Derive(basePath);
            var index = DeriveIndexFromTxId(txId);
            return baseKey.Derive(index);
        }
        
        /// <summary>
        /// Derives child public key from xpub for verification.
        /// </summary>
        public static PubKey DeriveVerificationKey(ExtPubKey xpub, string txId)
        {
            var index = DeriveIndexFromTxId(txId);
            return xpub.Derive(index).PubKey;
        }
    }
}
```

### 1.2 Extended Key Service

Create `IT.WebServices.OIP/Services/KeyService.cs`:

```csharp
using IT.WebServices.Crypto;
using IT.WebServices.Crypto.Extra;
using IT.WebServices.OIP.Crypto;
using NBitcoin;
using System.Security.Cryptography;

namespace IT.WebServices.OIP.Services
{
    public class KeyService
    {
        /// <summary>
        /// Creates a new OIP identity from a BIP-39 mnemonic.
        /// </summary>
        public static OipIdentity CreateFromMnemonic(string mnemonic, uint account = 0)
        {
            var mnemonicObj = new Mnemonic(mnemonic);
            var seed = mnemonicObj.DeriveSeed();
            var masterKey = ExtKey.CreateFromSeed(seed);
            
            // Derive signing xpub at m/176800'/0'/account'
            var signingBasePath = OipKeyDerivation.GetXpubBasePath(
                OipKeyDerivation.SubPurpose.IdentitySign, account);
            var signingXprv = masterKey.Derive(signingBasePath);
            var signingXpub = signingXprv.Neuter();
            
            // Generate did:key from master public key
            var did = GenerateDidKey(masterKey.Neuter().PubKey);
            
            return new OipIdentity
            {
                Did = did,
                SigningXpub = signingXpub.ToXPub(),
                SigningXprv = signingXprv,
                Account = account
            };
        }
        
        /// <summary>
        /// Generates did:key identifier from public key.
        /// </summary>
        public static string GenerateDidKey(PubKey pubKey)
        {
            // Multicodec prefix for secp256k1-pub: 0xe701
            var multicodec = new byte[] { 0xe7, 0x01 };
            var keyBytes = pubKey.ToBytes();
            var combined = multicodec.Concat(keyBytes).ToArray();
            return $"did:key:z{NBitcoin.DataEncoders.Encoders.Base58.EncodeData(combined)}";
        }
    }
    
    public class OipIdentity
    {
        public string Did { get; set; } = "";
        public string SigningXpub { get; set; } = "";
        public ExtKey SigningXprv { get; set; } = null!;
        public uint Account { get; set; }
    }
}
```

### 1.3 Update SigningService for HD Keys

Add to `SigningService.cs`:

```csharp
/// <summary>
/// Signs data using HD key derivation from xprv.
/// </summary>
public static void AddSignatureTagWithDerivation(
    DataForSignature data, 
    ExtKey signingXprv, 
    string txId)
{
    var index = OipKeyDerivation.DeriveIndexFromTxId(txId);
    var childKey = signingXprv.Derive(index);
    
    // Serialize without signature tag
    var json = JsonSerializer.Serialize(data);
    byte[] messageBytes = Encoding.UTF8.GetBytes(json);
    byte[] messageHash = Hashes.SHA256(messageBytes);
    
    // Sign with derived child key
    var ecdsa = childKey.PrivateKey.ToECDsa();
    var signatureBytes = ecdsa.SignHash(messageHash);
    var signature = Base64UrlEncoder.Encode(signatureBytes);
    
    data.Tags.Add(new DataTagNvPair() 
    { 
        Name = DataTagNvPair.CREATOR_SIGNATURE, 
        Value = signature 
    });
    
    // Add key index for verification
    data.Tags.Add(new DataTagNvPair() 
    { 
        Name = "KeyIndex", 
        Value = index.ToString() 
    });
}
```

### Deliverables
- [ ] `OipKeyDerivation.cs` with path constants and derivation logic
- [ ] `KeyService.cs` for identity creation
- [ ] Updated `SigningService` with HD key support
- [ ] Unit tests for index derivation

---

## Phase 2: Signature Verification Service

**Goal**: Enable validation of signed records using xpub or binding proofs.

### 2.1 Verification Service

Create `IT.WebServices.OIP/Services/VerificationService.cs`:

```csharp
using IT.WebServices.Crypto;
using IT.WebServices.Crypto.Extra;
using IT.WebServices.OIP.Crypto;
using IT.WebServices.OIP.Models;
using Microsoft.IdentityModel.Tokens;
using NBitcoin;
using NBitcoin.Crypto;
using System.Text;
using System.Text.Json;

namespace IT.WebServices.OIP.Services
{
    public enum VerificationMode { Xpub, Binding }
    
    public record VerificationResult(
        bool IsValid, 
        string? Error, 
        uint? KeyIndex,
        VerificationMode Mode);
    
    public class VerificationService
    {
        /// <summary>
        /// Verifies signature using xpub mode (non-hardened leaf).
        /// Path A from OIP spec.
        /// </summary>
        public static VerificationResult VerifyWithXpub(
            DataForSignature data,
            string xpub,
            string txId)
        {
            try
            {
                // Extract signature from tags
                var sigTag = data.Tags.FirstOrDefault(t => t.Name == DataTagNvPair.CREATOR_SIGNATURE);
                if (sigTag == null)
                    return new VerificationResult(false, "No CreatorSig tag found", null, VerificationMode.Xpub);
                
                var signature = sigTag.Value;
                
                // Remove signature tag for verification
                var dataWithoutSig = CloneWithoutSignature(data);
                
                // Compute message hash
                var json = JsonSerializer.Serialize(dataWithoutSig);
                var messageHash = Hashes.SHA256(Encoding.UTF8.GetBytes(json));
                
                // Derive child public key from xpub
                var extPub = ExtPubKey.Parse(xpub, Network.Main);
                var index = OipKeyDerivation.DeriveIndexFromTxId(txId);
                var childPubKey = extPub.Derive(index).PubKey;
                
                // Verify signature
                var sigBytes = Base64UrlEncoder.DecodeBytes(signature);
                var ecdsa = childPubKey.ToECDsa(CustomCurves.SecP256k1Curve);
                var isValid = ecdsa.VerifyHash(messageHash, sigBytes);
                
                return new VerificationResult(isValid, null, index, VerificationMode.Xpub);
            }
            catch (Exception ex)
            {
                return new VerificationResult(false, ex.Message, null, VerificationMode.Xpub);
            }
        }
        
        /// <summary>
        /// Verifies signature using binding proof mode (hardened leaf).
        /// Path B from OIP spec.
        /// </summary>
        public static VerificationResult VerifyWithBindingProof(
            DataForSignature data,
            string publicKeyMultibase,
            string bindingProofJws,
            string parentXpub)
        {
            try
            {
                // 1. Verify binding JWS with parent key
                var bindingValid = VerifyBindingJws(bindingProofJws, parentXpub);
                if (!bindingValid)
                    return new VerificationResult(false, "Binding proof invalid", null, VerificationMode.Binding);
                
                // 2. Extract child public key from binding
                var childPubKey = ExtractPublicKeyFromMultibase(publicKeyMultibase);
                
                // 3. Extract and verify record signature
                var sigTag = data.Tags.FirstOrDefault(t => t.Name == DataTagNvPair.CREATOR_SIGNATURE);
                if (sigTag == null)
                    return new VerificationResult(false, "No CreatorSig tag found", null, VerificationMode.Binding);
                
                var dataWithoutSig = CloneWithoutSignature(data);
                var json = JsonSerializer.Serialize(dataWithoutSig);
                var messageHash = Hashes.SHA256(Encoding.UTF8.GetBytes(json));
                
                var sigBytes = Base64UrlEncoder.DecodeBytes(sigTag.Value);
                var ecdsa = childPubKey.ToECDsa(CustomCurves.SecP256k1Curve);
                var isValid = ecdsa.VerifyHash(messageHash, sigBytes);
                
                return new VerificationResult(isValid, null, null, VerificationMode.Binding);
            }
            catch (Exception ex)
            {
                return new VerificationResult(false, ex.Message, null, VerificationMode.Binding);
            }
        }
        
        private static DataForSignature CloneWithoutSignature(DataForSignature data)
        {
            return new DataForSignature
            {
                Context = data.Context,
                Id = data.Id,
                Tags = data.Tags.Where(t => t.Name != DataTagNvPair.CREATOR_SIGNATURE).ToList(),
                Fragments = data.Fragments
            };
        }
        
        private static bool VerifyBindingJws(string jws, string parentXpub)
        {
            // TODO: Implement JWS verification
            throw new NotImplementedException();
        }
        
        private static PubKey ExtractPublicKeyFromMultibase(string multibase)
        {
            // TODO: Implement multibase decoding
            throw new NotImplementedException();
        }
    }
}
```

### 2.2 Key Rollover Service

Create `IT.WebServices.OIP/Services/KeyRolloverService.cs`:

```csharp
namespace IT.WebServices.OIP.Services
{
    /// <summary>
    /// Tracks key usage to enforce rollover rules.
    /// Rule: "once index N is used, all indexes less than N are burned"
    /// </summary>
    public class KeyRolloverService
    {
        private readonly Dictionary<string, uint> _highestUsedIndex = new();
        
        /// <summary>
        /// Checks if a key index has been burned (superseded by higher index).
        /// </summary>
        public bool IsKeyBurned(string creatorDid, uint keyIndex)
        {
            if (_highestUsedIndex.TryGetValue(creatorDid, out var highest))
            {
                return keyIndex < highest;
            }
            return false;
        }
        
        /// <summary>
        /// Records that a key index was used, potentially burning lower indices.
        /// </summary>
        public void RecordKeyUsage(string creatorDid, uint keyIndex)
        {
            if (!_highestUsedIndex.TryGetValue(creatorDid, out var current) || keyIndex > current)
            {
                _highestUsedIndex[creatorDid] = keyIndex;
            }
        }
        
        /// <summary>
        /// Gets the minimum valid key index for a creator.
        /// </summary>
        public uint GetMinimumValidIndex(string creatorDid)
        {
            return _highestUsedIndex.TryGetValue(creatorDid, out var highest) 
                ? highest 
                : 0;
        }
        
        /// <summary>
        /// Validates that a key index is not burned.
        /// </summary>
        public bool ValidateKeyIndex(string creatorDid, uint keyIndex)
        {
            return !IsKeyBurned(creatorDid, keyIndex);
        }
    }
}
```

### Deliverables
- [ ] `VerificationService.cs` with xpub and binding verification
- [ ] `KeyRolloverService.cs` for tracking burned keys
- [ ] Unit tests for verification round-trip
- [ ] Integration with TestBench

---

## Phase 3: DID Document Templates

**Goal**: Create W3C DID-compliant templates to replace legacy creatorRegistration.

### 3.1 didVerificationMethod Template

Create `IT.WebServices.OIP/Models/RecordTemplates/DidVerificationMethodRecordTemplate.cs`:

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    /// <summary>
    /// W3C DID Verification Method record with OIP derivation extensions.
    /// </summary>
    public class DidVerificationMethodRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:TODO_REGISTER_VM_TEMPLATE";

        [JsonPropertyName("0")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? VmId { get; set; }  // e.g., "#sign-0"

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? VmType { get; set; }  // Ed25519VerificationKey2020, oip:XpubDerivation2025, etc.

        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Controller { get; set; }

        [JsonPropertyName("3")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? PublicKeyMultibase { get; set; }

        [JsonPropertyName("4")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? PublicKeyJwkJson { get; set; }

        [JsonPropertyName("5")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Xpub { get; set; }

        [JsonPropertyName("6")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? DerivationSubPurpose { get; set; }

        [JsonPropertyName("7")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public uint? DerivationAccount { get; set; }

        [JsonPropertyName("8")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? DerivationPathPrefix { get; set; }

        [JsonPropertyName("9")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? LeafIndexPolicy { get; set; }  // "txid_hash" | "sequential" | "fixed"

        [JsonPropertyName("10")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public uint? LeafIndexFixed { get; set; }

        [JsonPropertyName("11")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? LeafHardened { get; set; }

        [JsonPropertyName("12")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Created { get; set; }

        [JsonPropertyName("13")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Expires { get; set; }

        [JsonPropertyName("14")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? Revoked { get; set; }

        [JsonPropertyName("15")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? BindingProofJws { get; set; }

        [JsonPropertyName("16")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? BindingProofPurpose { get; set; }
    }
}
```

### 3.2 didDocument Template

Create `IT.WebServices.OIP/Models/RecordTemplates/DidDocumentRecordTemplate.cs`:

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    /// <summary>
    /// W3C DID Document with OIP profile extension.
    /// </summary>
    public class DidDocumentRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:TODO_REGISTER_DID_TEMPLATE";

        [JsonPropertyName("0")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Did { get; set; }

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Controller { get; set; }

        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? VerificationMethod { get; set; }  // drefs

        [JsonPropertyName("3")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Authentication { get; set; }

        [JsonPropertyName("4")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? AssertionMethod { get; set; }

        [JsonPropertyName("5")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? KeyAgreement { get; set; }

        [JsonPropertyName("6")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? ServiceJson { get; set; }

        [JsonPropertyName("7")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? AlsoKnownAs { get; set; }

        // OIP Profile fields
        [JsonPropertyName("8")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipHandleRaw { get; set; }

        [JsonPropertyName("9")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipHandle { get; set; }

        [JsonPropertyName("10")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipName { get; set; }

        [JsonPropertyName("11")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipSurname { get; set; }

        [JsonPropertyName("12")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipLanguage { get; set; }

        [JsonPropertyName("13")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipSocialX { get; set; }

        [JsonPropertyName("14")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipSocialYoutube { get; set; }

        [JsonPropertyName("15")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipSocialInstagram { get; set; }

        [JsonPropertyName("16")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OipSocialTiktok { get; set; }

        [JsonPropertyName("17")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? AnchorArweaveTxid { get; set; }

        [JsonPropertyName("18")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? KeyBindingPolicy { get; set; }  // "xpub" | "binding"
    }
}
```

### 3.3 socialMedia Template

Create `IT.WebServices.OIP/Models/RecordTemplates/SocialMediaRecordTemplate.cs`:

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    public class SocialMediaRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:TODO_REGISTER_SOCIAL_TEMPLATE";

        [JsonPropertyName("0")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Website { get; set; }  // repeated dref

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Youtube { get; set; }  // repeated dref

        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? X { get; set; }

        [JsonPropertyName("3")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Instagram { get; set; }

        [JsonPropertyName("4")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Tiktok { get; set; }
    }
}
```

### 3.4 communication Template

Create `IT.WebServices.OIP/Models/RecordTemplates/CommunicationRecordTemplate.cs`:

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.RecordTemplates
{
    public class CommunicationRecordTemplate : IRecordTemplate
    {
        [JsonPropertyName("t")]
        public override string Template => "did:arweave:TODO_REGISTER_COMM_TEMPLATE";

        [JsonPropertyName("0")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Phone { get; set; }

        [JsonPropertyName("1")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Email { get; set; }

        [JsonPropertyName("2")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Signal { get; set; }
    }
}
```

### 3.5 Update IRecordTemplate

Update `IRecordTemplate.cs` to include new types:

```csharp
[JsonDerivedType(typeof(BasicRecordTemplate))]
[JsonDerivedType(typeof(CreatorRegistrationRecordTemplate))]
[JsonDerivedType(typeof(ImageRecordTemplate))]
[JsonDerivedType(typeof(PostRecordTemplate))]
[JsonDerivedType(typeof(DidDocumentRecordTemplate))]
[JsonDerivedType(typeof(DidVerificationMethodRecordTemplate))]
[JsonDerivedType(typeof(SocialMediaRecordTemplate))]
[JsonDerivedType(typeof(CommunicationRecordTemplate))]
public abstract class IRecordTemplate
{
    [JsonIgnore]
    public abstract string Template { get; }
}
```

### Deliverables
- [ ] `DidVerificationMethodRecordTemplate.cs`
- [ ] `DidDocumentRecordTemplate.cs`
- [ ] `SocialMediaRecordTemplate.cs`
- [ ] `CommunicationRecordTemplate.cs`
- [ ] Update `IRecordTemplate` with JsonDerivedType attributes
- [ ] Register templates on Arweave

---

## Phase 4: DID Resolution Service

**Goal**: Convert OIP records to W3C DID Documents.

### 4.1 W3C Models

Create `IT.WebServices.OIP/Models/W3c/W3cDidDocument.cs`:

```csharp
using System.Text.Json.Serialization;

namespace IT.WebServices.OIP.Models.W3c
{
    public class W3cDidDocument
    {
        [JsonPropertyName("@context")]
        public string[] Context { get; set; } = ["https://www.w3.org/ns/did/v1", "https://oip.dev/ns/v1"];
        
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";
        
        [JsonPropertyName("controller")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Controller { get; set; }
        
        [JsonPropertyName("verificationMethod")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<W3cVerificationMethod>? VerificationMethod { get; set; }
        
        [JsonPropertyName("authentication")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? Authentication { get; set; }
        
        [JsonPropertyName("assertionMethod")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? AssertionMethod { get; set; }
        
        [JsonPropertyName("keyAgreement")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? KeyAgreement { get; set; }
        
        [JsonPropertyName("service")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<W3cService>? Service { get; set; }
        
        [JsonPropertyName("alsoKnownAs")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public List<string>? AlsoKnownAs { get; set; }
        
        [JsonPropertyName("oip:profile")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public OipProfile? OipProfile { get; set; }
    }
    
    public class W3cVerificationMethod
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";
        
        [JsonPropertyName("type")]
        public string Type { get; set; } = "";
        
        [JsonPropertyName("controller")]
        public string Controller { get; set; } = "";
        
        [JsonPropertyName("publicKeyMultibase")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? PublicKeyMultibase { get; set; }
        
        [JsonPropertyName("publicKeyJwk")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public object? PublicKeyJwk { get; set; }
        
        // OIP extensions
        [JsonPropertyName("oip:xpub")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Xpub { get; set; }
        
        [JsonPropertyName("oip:derivationPath")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? DerivationPath { get; set; }
    }
    
    public class W3cService
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = "";
        
        [JsonPropertyName("type")]
        public string Type { get; set; } = "";
        
        [JsonPropertyName("serviceEndpoint")]
        public string ServiceEndpoint { get; set; } = "";
    }
    
    public class OipProfile
    {
        [JsonPropertyName("handle")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Handle { get; set; }
        
        [JsonPropertyName("name")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Name { get; set; }
        
        [JsonPropertyName("surname")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Surname { get; set; }
        
        [JsonPropertyName("language")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Language { get; set; }
        
        [JsonPropertyName("social")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public OipSocialLinks? Social { get; set; }
    }
    
    public class OipSocialLinks
    {
        [JsonPropertyName("x")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? X { get; set; }
        
        [JsonPropertyName("youtube")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Youtube { get; set; }
        
        [JsonPropertyName("instagram")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Instagram { get; set; }
        
        [JsonPropertyName("tiktok")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Tiktok { get; set; }
    }
}
```

### 4.2 DID Resolver Service

Create `IT.WebServices.OIP/Services/DidResolverService.cs`:

```csharp
using IT.WebServices.OIP.Models.RecordTemplates;
using IT.WebServices.OIP.Models.W3c;
using System.Text.Json;

namespace IT.WebServices.OIP.Services
{
    public class DidResolverService
    {
        /// <summary>
        /// Resolves a DID Document from stored OIP records.
        /// </summary>
        public async Task<W3cDidDocument> ResolveAsync(
            DidDocumentRecordTemplate didDoc,
            Func<string, Task<DidVerificationMethodRecordTemplate>> vmLoader)
        {
            var verificationMethods = new List<W3cVerificationMethod>();
            
            foreach (var vmDref in didDoc.VerificationMethod ?? [])
            {
                var vmRecord = await vmLoader(vmDref);
                verificationMethods.Add(ConvertToW3c(vmRecord, didDoc.Did!));
            }
            
            return new W3cDidDocument
            {
                Id = didDoc.Did!,
                Controller = didDoc.Controller,
                VerificationMethod = verificationMethods,
                Authentication = didDoc.Authentication,
                AssertionMethod = didDoc.AssertionMethod,
                KeyAgreement = didDoc.KeyAgreement,
                Service = ParseServices(didDoc.ServiceJson),
                AlsoKnownAs = didDoc.AlsoKnownAs,
                OipProfile = new OipProfile
                {
                    Handle = didDoc.OipHandle,
                    Name = didDoc.OipName,
                    Surname = didDoc.OipSurname,
                    Language = didDoc.OipLanguage,
                    Social = new OipSocialLinks
                    {
                        X = didDoc.OipSocialX,
                        Youtube = didDoc.OipSocialYoutube,
                        Instagram = didDoc.OipSocialInstagram,
                        Tiktok = didDoc.OipSocialTiktok
                    }
                }
            };
        }
        
        private W3cVerificationMethod ConvertToW3c(DidVerificationMethodRecordTemplate vm, string did)
        {
            return new W3cVerificationMethod
            {
                Id = vm.VmId?.StartsWith("#") == true ? $"{did}{vm.VmId}" : vm.VmId!,
                Type = vm.VmType!,
                Controller = vm.Controller!,
                PublicKeyMultibase = vm.PublicKeyMultibase,
                PublicKeyJwk = string.IsNullOrEmpty(vm.PublicKeyJwkJson) 
                    ? null 
                    : JsonSerializer.Deserialize<object>(vm.PublicKeyJwkJson),
                Xpub = vm.Xpub,
                DerivationPath = vm.DerivationPathPrefix
            };
        }
        
        private List<W3cService>? ParseServices(string? serviceJson)
        {
            if (string.IsNullOrEmpty(serviceJson)) return null;
            return JsonSerializer.Deserialize<List<W3cService>>(serviceJson);
        }
    }
}
```

### Deliverables
- [ ] W3C DID Document models
- [ ] `DidResolverService.cs`
- [ ] API endpoint for DID resolution
- [ ] Unit tests

---

## Phase 5: Creator Identity Workflow

**Goal**: End-to-end identity creation and publishing.

### 5.1 Identity Service

Create `IT.WebServices.OIP/Services/IdentityService.cs`:

```csharp
using IT.WebServices.OIP.Crypto;
using IT.WebServices.OIP.Models;
using IT.WebServices.OIP.Models.RecordTemplates;
using IT.WebServices.OIP.Models.W3c;
using NBitcoin;

namespace IT.WebServices.OIP.Services
{
    public class IdentityService
    {
        /// <summary>
        /// Creates a complete DID Document payload for a new creator.
        /// </summary>
        public DataForSignature CreateDidDocumentPayload(
            OipIdentity identity,
            OipProfile profile)
        {
            var vmId = Guid.NewGuid();
            var didDocId = Guid.NewGuid();
            
            // Verification Method
            var vm = new DidVerificationMethodRecordTemplate
            {
                VmId = "#sign",
                VmType = "oip:XpubDerivation2025",
                Controller = identity.Did,
                Xpub = identity.SigningXpub,
                DerivationSubPurpose = "identity.sign",
                DerivationAccount = identity.Account,
                DerivationPathPrefix = $"m/{OipKeyDerivation.OIP_PURPOSE}'/0'/{identity.Account}'",
                LeafIndexPolicy = "txid_hash",
                LeafHardened = false,
                Created = DateTime.UtcNow.ToString("O")
            };
            
            // DID Document
            var didDoc = new DidDocumentRecordTemplate
            {
                Did = identity.Did,
                Controller = identity.Did,
                VerificationMethod = new List<string> { "#" + vmId },
                Authentication = new List<string> { "#sign" },
                AssertionMethod = new List<string> { "#sign" },
                OipHandle = profile.Handle,
                OipName = profile.Name,
                OipSurname = profile.Surname,
                KeyBindingPolicy = "xpub"
            };
            
            // Basic metadata
            var basic = new BasicRecordTemplate
            {
                Name = profile.Name,
                Description = $"DID Document for {profile.Handle}",
                Date = DateTimeOffset.UtcNow
            };
            
            // Assemble payload
            var data = new DataForSignature();
            data.Tags.Add(new DataTagNvPair { Name = DataTagNvPair.CREATOR, Value = "self" });
            
            data.Fragments.Add(new DidFragments
            {
                Id = vmId.ToString(),
                DataType = "Record",
                RecordType = "didVerificationMethod",
                Records = [vm]
            });
            
            data.Fragments.Add(new DidFragments
            {
                Id = didDocId.ToString(),
                DataType = "Record",
                RecordType = "didDocument",
                Records = [basic, didDoc]
            });
            
            return data;
        }
    }
}
```

### 5.2 TestBench: TestDidIdentity

Create `TestBench/TestDidIdentity.cs`:

```csharp
using IT.WebServices.OIP.Crypto;
using IT.WebServices.OIP.Models.W3c;
using IT.WebServices.OIP.Services;
using System.Text.Json;

namespace TestBench
{
    internal class TestDidIdentity
    {
        public void Run()
        {
            // 1. Create identity from test mnemonic
            var mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            var identity = KeyService.CreateFromMnemonic(mnemonic, account: 0);
            
            Console.WriteLine($"DID: {identity.Did}");
            Console.WriteLine($"Signing xpub: {identity.SigningXpub}");
            Console.WriteLine();
            
            // 2. Create profile
            var profile = new OipProfile
            {
                Handle = "TestCreator",
                Name = "Test",
                Surname = "Creator"
            };
            
            // 3. Create DID Document payload
            var identityService = new IdentityService();
            var payload = identityService.CreateDidDocumentPayload(identity, profile);
            
            // 4. Sign with HD derivation (using placeholder txId for demo)
            var placeholderTxId = "PLACEHOLDER_TX_ID";
            SigningService.AddSignatureTagWithDerivation(payload, identity.SigningXprv, placeholderTxId);
            
            // 5. Output
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
            Console.WriteLine("=== DID Document Payload ===");
            Console.WriteLine(json);
            
            // 6. Verify signature
            Console.WriteLine();
            Console.WriteLine("=== Verification ===");
            var result = VerificationService.VerifyWithXpub(payload, identity.SigningXpub, placeholderTxId);
            Console.WriteLine($"Valid: {result.IsValid}");
            Console.WriteLine($"Key Index: {result.KeyIndex}");
        }
    }
}
```

### Deliverables
- [ ] `IdentityService.cs`
- [ ] `TestDidIdentity.cs`
- [ ] Integration tests
- [ ] Documentation

---

## Phase 6: Migration & Backward Compatibility

**Goal**: Support legacy creatorRegistration while enabling DID migration.

### 6.1 Migration Service

Create `IT.WebServices.OIP/Services/MigrationService.cs`:

```csharp
using IT.WebServices.OIP.Models.RecordTemplates;

namespace IT.WebServices.OIP.Services
{
    public class MigrationService
    {
        /// <summary>
        /// Creates a DID Document that links to a legacy creatorRegistration.
        /// </summary>
        public DidDocumentRecordTemplate MigrateLegacyCreator(
            CreatorRegistrationRecordTemplate legacy,
            string legacyTxId,
            string newDid)
        {
            return new DidDocumentRecordTemplate
            {
                Did = newDid,
                Controller = newDid,
                AlsoKnownAs = new List<string>
                {
                    $"dref:arweave:{legacyTxId}",
                    $"handle:{legacy.Handle}"
                },
                OipHandle = legacy.Handle,
                OipSurname = legacy.Surname,
                KeyBindingPolicy = "xpub"
            };
        }
    }
}
```

### 6.2 Dual-Mode Creator Resolver

Create `IT.WebServices.OIP/Services/CreatorResolverService.cs`:

```csharp
using IT.WebServices.OIP.Models.RecordTemplates;

namespace IT.WebServices.OIP.Services
{
    public record ResolvedCreator(
        string Identifier,
        string? Handle,
        string? SigningXpub,
        bool IsLegacy,
        string? LegacyTxId,
        DidDocumentRecordTemplate? DidDocument);
    
    public class CreatorResolverService
    {
        /// <summary>
        /// Resolves a creator reference, supporting both DID and legacy formats.
        /// </summary>
        public async Task<ResolvedCreator> ResolveAsync(
            string creatorRef,
            Func<string, Task<DidDocumentRecordTemplate?>> didLoader,
            Func<string, Task<CreatorRegistrationRecordTemplate?>> legacyLoader)
        {
            // Try DID format first
            if (creatorRef.StartsWith("did:"))
            {
                var didDoc = await didLoader(creatorRef);
                if (didDoc != null)
                {
                    return new ResolvedCreator(
                        creatorRef,
                        didDoc.OipHandle,
                        null, // TODO: resolve from VM
                        false,
                        null,
                        didDoc);
                }
            }
            
            // Try as DID document txId
            var didByTxId = await didLoader(creatorRef);
            if (didByTxId != null)
            {
                return new ResolvedCreator(
                    didByTxId.Did!,
                    didByTxId.OipHandle,
                    null,
                    false,
                    null,
                    didByTxId);
            }
            
            // Fall back to legacy creatorRegistration
            var legacy = await legacyLoader(creatorRef);
            if (legacy != null)
            {
                return new ResolvedCreator(
                    creatorRef,
                    legacy.Handle,
                    legacy.SigningXpub,
                    true,
                    creatorRef,
                    null);
            }
            
            throw new Exception($"Creator not found: {creatorRef}");
        }
    }
}
```

### Deliverables
- [ ] `MigrationService.cs`
- [ ] `CreatorResolverService.cs`
- [ ] Migration CLI tool
- [ ] Backward-compatible verification

---

## Phase 7: Integration with OIP Indexer

**Goal**: Connect to oip-arweave-indexer infrastructure.

### 7.1 Template Registration

Register new templates on Arweave and configure:

```javascript
// oip-arweave-indexer/config/templates.config.js
module.exports = {
    defaultTemplates: {
        // Existing
        basic: "-9DirnjVO1FlbEW1lN8jITBESrTsQKEM_BoZ1ey_0mk",
        post: "op6y-d_6bqivJ2a2oWQnbylD4X_LH6eQyR6rCGqtVZ8",
        creatorRegistration: "LEGACY_CREATOR_TX_ID",
        
        // New v0.9.0
        didDocument: "NEW_DID_DOC_TX_ID",
        didVerificationMethod: "NEW_DID_VM_TX_ID",
        socialMedia: "NEW_SOCIAL_TX_ID",
        communication: "NEW_COMM_TX_ID"
    }
}
```

### 7.2 Elasticsearch Schema

```json
{
  "did_documents": {
    "mappings": {
      "properties": {
        "did": { "type": "keyword" },
        "controller": { "type": "keyword" },
        "oip_handle": { "type": "keyword" },
        "oip_name": { "type": "text" },
        "key_binding_policy": { "type": "keyword" },
        "anchor_txid": { "type": "keyword" },
        "also_known_as": { "type": "keyword" },
        "verification_methods": {
          "type": "nested",
          "properties": {
            "vm_id": { "type": "keyword" },
            "vm_type": { "type": "keyword" },
            "xpub": { "type": "keyword" }
          }
        }
      }
    }
  }
}
```

### 7.3 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/did/:did` | GET | Resolve DID to W3C Document |
| `POST /api/did/register` | POST | Register new DID identity |
| `POST /api/did/migrate` | POST | Migrate legacy creator to DID |
| `POST /api/did/:did/verify` | POST | Verify a signed payload |
| `GET /api/creators/:id` | GET | Unified creator lookup |

### Deliverables
- [ ] Template registration on Arweave
- [ ] Elasticsearch schema updates
- [ ] API endpoint implementations
- [ ] Integration tests

---

## Implementation Timeline

| Phase | Duration | Dependencies | Priority |
|-------|----------|--------------|----------|
| **Phase 0** | ✅ Complete | None | Done |
| **Phase 1**: HD Key Derivation | 1 week | Phase 0 | 🔴 Critical |
| **Phase 2**: Verification Service | 1 week | Phase 1 | 🔴 Critical |
| **Phase 3**: DID Templates | 1 week | Phase 1 | 🔴 Critical |
| **Phase 4**: DID Resolution | 1 week | Phase 2, 3 | 🟡 High |
| **Phase 5**: Identity Workflow | 1 week | Phase 1-4 | 🟡 High |
| **Phase 6**: Migration | 1 week | Phase 5 | 🟢 Medium |
| **Phase 7**: Indexer Integration | 2 weeks | Phase 1-6 | 🟢 Medium |

**Total estimated time**: 8-10 weeks

---

## Testing Strategy

### Unit Tests
- Key derivation path generation
- Index derivation from txId (`"oip:" + txId` → uint31)
- Signature generation/verification round-trip
- Template serialization/deserialization
- W3C DID Document conversion

### Integration Tests
- Full identity creation → publish → resolve cycle
- Sign record → index → verify workflow
- Legacy migration path
- Cross-node DID resolution
- Key rollover enforcement

### TestBench Scenarios

| Test | Description |
|------|-------------|
| `TestSampleCreator` | ✅ Legacy creator registration |
| `TestSamplePost` | ✅ Post with creator reference |
| `TestKeyDerivation` | SLIP-0043 path validation |
| `TestSignAndVerify` | Round-trip signature validation |
| `TestDidIdentity` | Full DID document workflow |
| `TestMigration` | Legacy to DID upgrade |
| `TestKeyRollover` | Burn rule enforcement |

---

## Security Considerations

1. **Master Key Protection**: Never expose master private key; only use derived child keys for signing
2. **Hardened vs Non-Hardened**: Use hardened paths for sensitive operations, non-hardened for xpub verification
3. **Key Rollover**: Enforce "index N burns all < N" rule at verification time
4. **Binding Proofs**: Require JWS attestation for hardened leaf keys
5. **Migration Security**: Validate ownership before allowing legacy→DID migration

---

## Appendix: v0.9.0 Template Schemas

### creatorRegistration (Legacy)

```json
{
  "handle": "string",
  "index_handle": 0,
  "surname": "string",
  "index_surname": 1,
  "signingXpub": "string",
  "index_signingXpub": 2,
  "delegationXpub": "string",
  "index_delegationXpub": 3,
  "revocationList": "repeated string",
  "index_revocationList": 4
}
```

### socialMedia

```json
{
  "website": "repeated dref",
  "index_website": 0,
  "youtube": "repeated dref",
  "index_youtube": 1,
  "x": "string",
  "index_x": 2,
  "instagram": "repeated string",
  "index_instagram": 3,
  "tiktok": "repeated string",
  "index_tiktok": 4
}
```

### communication

```json
{
  "phone": "repeated string",
  "index_phone": 0,
  "email": "repeated string",
  "index_email": 1,
  "signal": "repeated string",
  "index_signal": 2
}
```

---

## References

- [OIP Technical Overview](../oip-arweave-indexer/docs/OIP_TECHNICAL_OVERVIEW.md)
- [oip-update-to-09.md](./oip-update-to-09.md) - Original specification
- [W3C DID Core](https://www.w3.org/TR/did-core/)
- [SLIP-0043](https://github.com/satoshilabs/slips/blob/master/slip-0043.md) - Custom Purpose Paths
- [BIP-32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki) - HD Wallets
- [RFC 8812](https://datatracker.ietf.org/doc/html/rfc8812) - ECDSA for JOSE

