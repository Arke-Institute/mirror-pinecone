So. we need to now do this mirror as pushing to pineceone ! so what this means is that we
  need to take each incoming event and reflect it in pinecone, so any creation event we
  upsert and any update we also upsert ... check out the format that this stuff is returned
  in but we should be returning metadata... as for what to embed we will want to use a hierarchy of fields. we can include them all if they are availble. if none of these fields are availble and no text is available then 
  we can just skip that PI. the only metadata that should be stored in the index is PI and last updated. oh and also date we should have a date filter, the date range in the metadata if it's there we should autoconvert to to a date numeric that we can filter by in pinecone (focus on year-month-day ; minutes or seconds is overkill, these are historical docs)
  We should also have the field nara_naId in the metadata to filter by (there should only be one nara_naId per PI)... 
  Also included in the metadata should be of course the PI, this should come first this is the most important thing.... the PI should be the ID of the vector !!! 
  The fields we are looking for embedding and the date format/nara_naid the fields to filter by should NOT BE HARDCODED ; the script should take it some kind of input that contains this information some config file or something...  it needs to specify both the field and what we are doing with it and if any format manipulation has to occur it should specify that somehow  
  if multiple fields match we should just append them together into one string and include the field name in the string with a simple ":"
  As for which fields to embed i think generally we should embed: name, type, description, title, creators.heading, extracted_text, as well as 
  We can parse the whole json but it may just be easier to do some kind of grep search or simple find instead.
  Also the date range field is a bit finicky in some files it's "date-range" in others there is this structure with inclusive start and end database  
  "inclusiveEndDate": {
          "dateQualifier": "ca.",
          "logicalDate": "1998-12-31",
          "year": 1998
        },
        "inclusiveStartDate": {
          "dateQualifier": "ca.",
          "logicalDate": "1994-01-01",
          "year": 1994
        },
    So by doing it this way, by having this hierarchical structure, making it so it's not just find the first title or first description, it's just going to do all of them. It means that as we work our way down the tree, it'll have the full text there. Actually, the most rich will be the file unit, which will have all the parental information, as well as the child info. But the digital objects themselves will have just the extracted text alone, which is helpful. So that should really handle most of the use cases. Now, maybe if they're just looking for a collection or a series, like that should also be findable. It's just a lot less likely.

Now all this stuff should go into the same index, but we should base the namespace that each item is in based on the schema. So we're going to do it based on series collection, file unit, digital object. Those are the namespaces it should go in. Don't include the NARA, just look at the stuff that's after it—the hyphen there, and that will be the namespace. Again, same index, different namespaces. Again, would love to make this as customizable as possible by making it so that namespace criteria is somehow in a config file of some type that's specified outside of the main program that's running so that it's more adaptable to future schemas. 

"schema": "nara-series@v1",
"schema": "nara-collection@v1",
"schema": "nara-fileUnit@v1",
"schema": "nara-digitalObject@v1",

Now another thing you'll see is that beyond the metadata, there's also the manifest. And the manifest is going to have a series of things, including what files are in the current version, as well as parents and children. So we should just be using the latest manifest. First of all, there's no need to walk and vectorize multiple versions. But we should also be including as a field the parental ID. So this will require a little bit of logic to figure out, but we're going to include the parent PI and walk that tree all the way up until there's no parent. So it should only be like four calls or something. But we want to get the ancestry of everyone and list that as an array field in the metadata. This will help with top-down filtering later on when we want to search through a given collection, and we can use the filter, like parent ID in X, and then just as long as it includes one of those parents, that's fine. So yeah, that's going to require like per PI, like a couple more calls. We can make it more efficient by like caching some of the relationships at the higher levels.

Again, there's no need to really overcomplicate that. It's just another thing that we should do, and it should require just getting the manifest of the parent and then the parent's parent and the parent's parent until you get to the top. 
  
  As for how we should embed we will use openai text embedding 3 small .. just regular no batch
  we should use the dimensions parameter to reduce the dimensions from 1536 to 768 (see below)
  the max input of the model is 8192 tokens, it's unlikely we will reach this limit but we should add a fail safe of 5000 words max (you can do a rough character estimate as well say ~20k characters max)
  make sure to use mutliple new scripts and organize them within the src folder, don't put everything in the mirror.ts file 

Create embeddings
post
 
https://api.openai.com/v1/embeddings
Creates an embedding vector representing the input text.

Request body
input
string or array

Required
Input text to embed, encoded as a string or array of tokens. To embed multiple inputs in a single request, pass an array of strings or array of token arrays. The input must not exceed the max input tokens for the model (8192 tokens for all embedding models), cannot be an empty string, and any array must be 2048 dimensions or less. Example Python code for counting tokens. In addition to the per-input token limit, all embedding models enforce a maximum of 300,000 tokens summed across all inputs in a single request.

model
string

Required
ID of the model to use. You can use the List models API to see all of your available models, or see our Model overview for descriptions of them.

dimensions
integer

Optional
The number of dimensions the resulting output embeddings should have. Only supported in text-embedding-3 and later models.

encoding_format
string

Optional
Defaults to float
The format to return the embeddings in. Can be either float or 
base64
.

user
string

Optional
A unique identifier representing your end-user, which can help OpenAI to monitor and detect abuse. Learn more.

import OpenAI from "openai";

const openai = new OpenAI();

async function main() {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: "The quick brown fox jumped over the lazy dog",
    encoding_format: "float",
  });

  console.log(embedding);
}

main();
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [
        0.0023064255,
        -0.009327292,
        .... (1536 floats total for ada-002)
        -0.0028842222,
      ],
      "index": 0
    }
  ],
  "model": "text-embedding-ada-002",
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
Vector embeddings
Learn how to turn text into numbers, unlocking use cases like search.
New embedding models
text-embedding-3-small and text-embedding-3-large, our newest and most performant embedding models, are now available. They feature lower costs, higher multilingual performance, and new parameters to control the overall size.
What are embeddings?
OpenAI’s text embeddings measure the relatedness of text strings. Embeddings are commonly used for:

Search (where results are ranked by relevance to a query string)
Clustering (where text strings are grouped by similarity)
Recommendations (where items with related text strings are recommended)
Anomaly detection (where outliers with little relatedness are identified)
Diversity measurement (where similarity distributions are analyzed)
Classification (where text strings are classified by their most similar label)
An embedding is a vector (list) of floating point numbers. The distance between two vectors measures their relatedness. Small distances suggest high relatedness and large distances suggest low relatedness.

Visit our pricing page to learn about embeddings pricing. Requests are billed based on the number of tokens in the input.

How to get embeddings
To get an embedding, send your text string to the embeddings API endpoint along with the embedding model name (e.g., text-embedding-3-small):

Example: Getting embeddings
import OpenAI from "openai";
const openai = new OpenAI();

const embedding = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: "Your text string goes here",
  encoding_format: "float",
});

console.log(embedding);
The response contains the embedding vector (list of floating point numbers) along with some additional metadata. You can extract the embedding vector, save it in a vector database, and use for many different use cases.

{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [
        -0.006929283495992422,
        -0.005336422007530928,
        -4.547132266452536e-05,
        -0.024047505110502243
      ],
    }
  ],
  "model": "text-embedding-3-small",
  "usage": {
    "prompt_tokens": 5,
    "total_tokens": 5
  }
}
By default, the length of the embedding vector is 1536 for text-embedding-3-small or 3072 for text-embedding-3-large. To reduce the embedding's dimensions without losing its concept-representing properties, pass in the dimensions parameter. Find more detail on embedding dimensions in the embedding use case section.

Embedding models
OpenAI offers two powerful third-generation embedding model (denoted by -3 in the model ID). Read the embedding v3 announcement blog post for more details.

Usage is priced per input token. Below is an example of pricing pages of text per US dollar (assuming ~800 tokens per page):

Model	~ Pages per dollar	Performance on MTEB eval	Max input
text-embedding-3-small	62,500	62.3%	8192
text-embedding-3-large	9,615	64.6%	8192
text-embedding-ada-002	12,500	61.0%	8192
Use cases




Example file unit: Entity: 01K7JRF6MPTFVYA0X2S593FFGQ
Version: 25 | Updated: 10/14/2025, 9:41:45 PM

Added child entity 01K7JRFJABSVB1PGY4PDGP3X4R

Components
catalog_record
{
  "access_restriction": {
    "note": "These records may need to be screened for personal privacy, and law enforcement under 5 U.S.C. 552 (b) prior to public release.",
    "specificAccessRestrictions": [
      {
        "restriction": "FOIA (b)(1) National Security",
        "securityClassification": "Secret"
      },
      {
        "restriction": "FOIA (b)(2) Internal Personnel Rules and Practices"
      },
      {
        "restriction": "FOIA (b)(3) Statute"
      },
      {
        "restriction": "FOIA (b)(6) Personal Information"
      },
      {
        "restriction": "FOIA (b)(7c) Law Enforcement"
      },
      {
        "restriction": "FOIA (b)(7e) Law Enforcement"
      },
      {
        "restriction": "FOIA (b)(7f) Law Enforcement"
      }
    ],
    "status": "Restricted - Partly"
  },
  "collection_naId": 7388842,
  "digital_object_count": 24,
  "foia_tracking": "LPWJC 2006-0459-F",
  "import_timestamp": "2025-10-15T01:41:33.447411Z",
  "level": "fileUnit",
  "nara_full_metadata": {
    "accessRestriction": {
      "note": "These records may need to be screened for personal privacy, and law enforcement under 5 U.S.C. 552 (b) prior to public release.",
      "specificAccessRestrictions": [
        {
          "restriction": "FOIA (b)(1) National Security",
          "securityClassification": "Secret"
        },
        {
          "restriction": "FOIA (b)(2) Internal Personnel Rules and Practices"
        },
        {
          "restriction": "FOIA (b)(3) Statute"
        },
        {
          "restriction": "FOIA (b)(6) Personal Information"
        },
        {
          "restriction": "FOIA (b)(7c) Law Enforcement"
        },
        {
          "restriction": "FOIA (b)(7e) Law Enforcement"
        },
        {
          "restriction": "FOIA (b)(7f) Law Enforcement"
        }
      ],
      "status": "Restricted - Partly"
    },
    "ancestors": [
      {
        "collectionIdentifier": "WJC-NSCSW",
        "distance": 2,
        "inclusiveEndDate": {
          "dateQualifier": "ca.",
          "logicalDate": "2001-12-31",
          "year": 2001
        },
        "inclusiveStartDate": {
          "dateQualifier": "ca.",
          "logicalDate": "1993-01-01",
          "year": 1993
        },
        "levelOfDescription": "collection",
        "naId": 7388842,
        "title": "Records of the National Security Council Speechwriting Office (Clinton Administration)"
      },
      {
        "creators": [
          {
            "abolishDate": {
              "logicalDate": "2001-12-31",
              "year": 2001
            },
            "authorityType": "organization",
            "creatorType": "Most Recent",
            "establishDate": {
              "logicalDate": "1993-01-01",
              "year": 1993
            },
            "heading": "President (1993-2001 : Clinton). National Security Council. (1993 - 2001)",
            "naId": 10500730
          }
        ],
        "distance": 1,
        "inclusiveEndDate": {
          "dateQualifier": "ca.",
          "logicalDate": "1998-12-31",
          "year": 1998
        },
        "inclusiveStartDate": {
          "dateQualifier": "ca.",
          "logicalDate": "1994-01-01",
          "year": 1994
        },
        "levelOfDescription": "series",
        "naId": 7585787,
        "title": "Antony Blinken's Files"
      }
    ],
    "dataControlGroup": {
      "groupCd": "LPWJC",
      "groupId": "ou=NLWJC,ou=groups"
    },
    "digitalObjects": [
      {
        "objectFileSize": 393216,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_001.JPG",
        "objectId": "55259255",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_001.JPG"
      },
      {
        "objectFileSize": 409600,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_002.JPG",
        "objectId": "55259256",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_002.JPG"
      },
      {
        "objectFileSize": 475136,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_003.JPG",
        "objectId": "55259257",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_003.JPG"
      },
      {
        "objectFileSize": 557056,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_004.JPG",
        "objectId": "55259258",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_004.JPG"
      },
      {
        "objectFileSize": 487049,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_005.JPG",
        "objectId": "55259259",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_005.JPG"
      },
      {
        "objectFileSize": 475136,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_006.JPG",
        "objectId": "55259260",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_006.JPG"
      },
      {
        "objectFileSize": 581632,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_007.JPG",
        "objectId": "55259261",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_007.JPG"
      },
      {
        "objectFileSize": 528910,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_008.JPG",
        "objectId": "55259262",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_008.JPG"
      },
      {
        "objectFileSize": 499712,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_009.JPG",
        "objectId": "55259263",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_009.JPG"
      },
      {
        "objectFileSize": 503804,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_010.JPG",
        "objectId": "55259264",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_010.JPG"
      },
      {
        "objectFileSize": 450560,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_011.JPG",
        "objectId": "55259265",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_011.JPG"
      },
      {
        "objectFileSize": 450560,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_012.JPG",
        "objectId": "55259266",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_012.JPG"
      },
      {
        "objectFileSize": 524288,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_013.JPG",
        "objectId": "55259267",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_013.JPG"
      },
      {
        "objectFileSize": 516096,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_014.JPG",
        "objectId": "55259268",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_014.JPG"
      },
      {
        "objectFileSize": 491520,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_015.JPG",
        "objectId": "55259269",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_015.JPG"
      },
      {
        "objectFileSize": 483328,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_016.JPG",
        "objectId": "55259270",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_016.JPG"
      },
      {
        "objectFileSize": 409600,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_017.JPG",
        "objectId": "55259271",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_017.JPG"
      },
      {
        "objectFileSize": 475136,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_018.JPG",
        "objectId": "55259272",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_018.JPG"
      },
      {
        "objectFileSize": 409600,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_019.JPG",
        "objectId": "55259273",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_019.JPG"
      },
      {
        "objectFileSize": 450560,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_020.JPG",
        "objectId": "55259274",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_020.JPG"
      },
      {
        "objectFileSize": 548864,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_021.JPG",
        "objectId": "55259275",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_021.JPG"
      },
      {
        "objectFileSize": 475136,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_022.JPG",
        "objectId": "55259276",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_022.JPG"
      },
      {
        "objectFileSize": 548864,
        "objectFilename": "42_t_7585787_20060459F_014_008_2016_Page_023.JPG",
        "objectId": "55259277",
        "objectType": "Image (JPG)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-JPG/Box_14/42-t-7585787-20060459F-014-008-2016/42_t_7585787_20060459F_014_008_2016_Page_023.JPG"
      },
      {
        "extractedText": "\nCase Number: 2006-0459-F\nFOIA\nMARKER\nThis is not a textual record. This is used as an\nadministrative marker by the Clinton Presidential\nLibrary Staff.\nFolder Title:\nUNGA Speech-Big Type\nStaff Office-Individual:\nSpeechwriting-Blinken\nOriginal OA/ID Number:\n3382\nRow:\nSection:\nShelf:\nPosition:\nStack:\n48\n5\n10\n3\nV\n10/21/95\nMidnight\nPRESIDENT WILLIAM JEFFERSON CLINTON\nREMARKS TO THE\nUNITED NATIONS GENERAL ASSEMBLY\nON THE OCCASION OF\nTHE UNITED NATIONS 50TH ANNIVERSARY\nNEW YORK\nOCTOBER 22, 1995\n2\nMr. President, Mr. Secretary-General, Excellencies,\nDistinguished Guests: This week, the United Nations is fifty\nyears old. The dreams of its founders have only been partly\nrealized. But its promise endures. The United Nations is the\nproduct of faith and knowledge: faith that people from different\nbackgrounds can work together for tolerance and peace;\nknowledge that this faith will forever be challenged by the\nforces of intolerance and aggression. Now, we must summon\nthat faith -- and that knowledge -- to meet the challenges of a\nnew era.\n3\nThe United Nations' value can be seen the world over: in the\nnourished bodies of once-starving children.. in the full lives of\nthose immunized against disease. in the eyes of students\nexposed to human knowledge in the environment sustained\nin refugees saved in peace kept.\nIn the United States, some people ask -- why bother with the\nUN? America is strong. We can go it alone. Yes, if America's\nvital interests are at stake, we will act, if we have to, alone. But\nour values and our interests are also served by working with the\nUN. The UN helps the peacemakers, the care providers, the\ndefenders of freedom and human rights, the architects of\neconomic prosperity and the protectors of our planet spread the\nrisk, share the burden, and increase the impact of our efforts.\n4\nLast year, I pledged that the United States would continue to\ncontribute substantially to the UN's finances. Historically the\nUnited States has been -- and today it remains -- the largest\nsingle contributor to the United Nations. I am determined that\nwe fully meet our obligations. And I will work closely with\nCongress on a plan to free up the funding America owes the\nUnited Nations.\nBut all who contribute to the UN's work and care about its\nfuture must be committed to reform to ending bureaucratic\ninefficiency and outdated priorities. The UN must be able to\nshow that the money it receives supports services that save or\nenrich peoples' lives -- not unneeded overhead.\n5\nReform requires breaking up bureaucratic fiefdoms.\neliminating obsolete agencies making programs do more with\nless. The UN must reform to remain relevant and to play a\nstill stronger role in the march of peace, freedom and prosperity\nsweeping the globe:\nIn the Middle East and Northern Ireland, people are turning the\npage on the past and embracing a future of peace. In South\nAfrica and Haiti, long nights of fear have given way to new days\nof freedom. In Europe, the goal of an integrated, peaceful and\ndemocratic continent is within our grasp.\n6\nAnd in the Balkans, NATO's resolve and the international\ncommunity's determination have made the prospects for peace\nbrighter than they have been in four years. Let me salute the\nUN's efforts on behalf of the people of Bosnia. The nations that\ntook part in UNPROFOR kept the toll of this terrible war -- in\nlives lost. in wounds left unhealed in children left unfed --\nfrom being far graver still.\nNext week, the parties to the war in Bosnia will meet in Dayton,\nOhio, under the auspices of the United States and our Contact\nGroup partners -- the United Kingdom, France, Germany and\nRussia -- to intensify the search for peace. Many fundamental\ndifferences remain. But I urge the parties to seize this chance\nfor a settlement. If they achieve peace, the United States will be\nthere with our friends and allies to help secure it.\n7\nAll over the world people yearn to live in peace to build a\nbetter life than their parents had -- and to pass on an even better\none to their children. Today, that dream is becoming a reality\nfor more people than ever before.\nBut our time is not free of peril. As the Cold War gives way to\nthe global village, too many people remain vulnerable to\npoverty, disease and underdevelopment. And all of us are\nexposed to the organized forces of intolerance and destruction:\nethnic and religious hatred the reckless aggression of rogue\nstates. terrorism organized crime. drug trafficking and the\nproliferation of weapons of mass destruction.\n8\nThese forces would spread darkness over light disintegration\nover integration. chaos over community. They are the enemies\nof our time and we must defeat them -- together.\nToday, information, products and money flash across our planet\nat the stroke of a computer key. They bring extraordinary\nopportunities to build a safer and more prosperous future. to\nprotect our planet to better share humanity's genius for\nprogress.\nBut in our global village, trouble on the far end of town soon\nbecomes a plague on everyone's house. We can't free our own\nneighborhoods from drug-related crime without the help of\ncountries where drugs are produced or transported\n9\nWe can't track down foreign terrorists without assistance from\nforeign governments. We can't prosper or preserve our own\nenvironment unless sustainable development is a reality for all\nnations. And our vigilance alone can't keep nuclear materials\nstored half a world away from falling into the wrong hands.\nNowhere is cooperation more vital than in fighting the\nincreasingly interconnected groups that traffic in terror,\norganized crime, drug smuggling and the spread of weapons of\nmass destruction. No one is immune:\nNot the people of Japan -- where terrorists unleashed nerve gas\nin the subway and poisoned thousands of commuters.\n10\nNot the people of Latin America or Southeast Asia -- where\ndrug traffickers wielding imported weapons have murdered\njudges, journalists, police officers and innocent passers-by.\nNot the people of Israel and France -- where hatemongers have\nblown up buses and trains full of children with suitcase bombs\nmade from smuggled explosives.\nNot the people of the former Soviet Union and Central Europe --\nwhere organized criminals seek to weaken new democracies and\nprey on decent, hard working men and women.\n11\nAnd not the people of the United States -- where homegrown\nterrorists blew up a federal building in the heart of America.\nand where foreign terrorists tried to topple the World Trade\nCenter and plotted to destroy the very hall we are gathered in\ntoday.\nThese forces jeopardize the powerful global trend toward peace\nand freedom. They undermine fragile new democracies. They\nsap the strength from developing countries. They threaten our\nefforts to build a safer, more prosperous world for our children.\nToday, I call upon all nations to join in the fight against them.\nAnd I pledge to you that the United States will remain an\nvigorous leader in this fight. Our common efforts are yielding\nresults:\n12\nTo reduce the threat of weapons of mass destruction, the United\nStates is working with Russia to cut our nuclear arsenals by two-\nthirds from their Cold War height. We supported Ukraine,\nKazakhstan and Belarus in their farsighted decision to remove\nthe nuclear weapons left on their land when the Soviet Union\ndissolved. We are working with the states of the former Soviet\nUnion to safeguard nuclear materials and to convert them to\npeaceful use. We persuaded North Korea to freeze its nuclear\nprogram under international monitoring. We helped achieve\nthe indefinite extension of the Non-Proliferation Treaty. These\nactions have made it less likely that weapons of mass destruction\nwill be used -- or will wind up in the wrong hands.\n13\nTo stem the flow of narcotics and stop the spread of organized\ncrime, we are cooperating with many of the governments in this\nroom -- sharing information, providing military support,\ninitiating anti-corruption programs. And we're getting results:\nwith Colombian authorities, we've cracked down on the cartels\nthat control the world cocaine market. Two years ago, the\ncartels' leaders lived as billionaires beyond the law -- now,\nmany are living as prisoners behind bars.\nTo take on terrorists, we are maintaining strong sanctions\nagainst states that sponsor terrorism and defy the rule of law\n--\nsuch as Iran, Iraq, Libya and Sudan. We have increased\nfunding, manpower and training for our law enforcement\nagencies and we are cooperating with other nations more closely\nthan ever before.\n14\nNothing we do will make us invulnerable. But we can all\nbecome less vulnerable if we constantly intensify our efforts to\ndefeat the forces of destruction.\nThat is why, today, I am announcing new initiatives to fight\ninternational organized crime, drug trafficking, terrorism and the\nspread of weapons of mass destruction. These initiatives have\ntwo parts. First, steps the United States will take -- and which\nwe hope others will join. Second, an international Declaration\nthat sets out a plan of action to promote the safety of the world's\ncitizens.\nFirst, the steps America will take.\n15\nYesterday, I directed our government to identify and put on\nnotice nations that tolerate money laundering. Criminal\nenterprises are moving vast sums of ill gotten gains through\nthe international financial system with impunity. We must\nnot allow them to wash the blood off profits from the sale of\ndrugs, from terror or organized crime. Nations should bring\ntheir banks and financial systems into conformity with\ninternational anti-money laundering standards. We will work\nwith them to help them do so. If they fail to comply, we will\nconsider appropriate sanctions.\n16\nI also directed our government to identify the front companies\nand freeze the assets of the largest drug ring in the world: the\nCali Cartel. We want to cut off its economic lifelines and\nstop our own people from dealing unknowingly with\ncompanies financed by blood money. Cali and the other\nmajor cartels are a grave threat to everyone's security. We\nmust stop them.\nFinally, I instructed our Justice Department to prepare\nlegislation to provide other government agencies with the\ntools they need to better respond to international organized\ncrime.\n17\nTo succeed, we know that we must work with others. Today, to\nstrengthen all our citizens' basic safety, I invite every country to\njoin in negotiating and endorsing a Declaration on International\nCrime and Citizens' Safety.\nThat Declaration should include:\nA \"No Sanctuary\" Pledge. Organized criminals, terrorists,\ndrug traffickers and smugglers should have nowhere to run\nand nowhere to hide. They won't if we convince more\nnations to track down international fugitives, deny them\nsanctuary, seize their assets and extradite them or bring them\nto justice.\n18\nA Counter-Terrorism Pact: We will urge more states to ratify\nexisting anti-terrorism treaties and to work with us to shut\ndown the gray markets that outfit terrorists and criminals with\nfirearms and false documents.\nAn Anti-Narcotics Offensive: The international drug trade\npoisons our people. It breeds violence. It tears at the moral\nfabric of our societies. We must step up the investigation and\nprosecution of drug cartels and the destruction of drug crops -\n- even as we work to decrease the demand for drugs in\nconsumer nations like the United States.\n19\nAn \"Effective Police Forces\" Partnership: International\ncriminal organizations target nations whose law enforcement\nagencies lack the resources and experience to stop them. To\nhelp police in the new democracies of Central Europe, the\nUnited States and Hungary established an International Law\nEnforcement Academy in Budapest. Now, we should\nconsider creating a network of centers around the world to\nteach the latest crime fighting techniques and share\ntechnology.\nA \"Illegal Arms and Deadly Materials\" Control Effort: A\npackage the size of a child's lunch bag held the poison gas\nused to terrorize Tokyo. A lump of plutonium no bigger than\na soda can is enough to make an atomic bomb.\n20\nBuilding on efforts already underway with the states of the\nformer Soviet Union and with our G-7 partners, we will seek\nto better account for, store and safeguard materials with mass\ndestructive power. We should strengthen the Biological\nWeapons Convention pass the Comprehensive Test Ban\nTreaty and eliminate the scourge of landmines. We will\npress other countries -- and our own Congress -- to ratify the\nChemical Weapons Convention. And we will intensify our\nefforts to combat the global illegal arms network that fuels\nterrorism, equips drugs cartels and prolongs deadly conflicts.\nThis is a full and challenging agenda. But we must complete it.\nOur first responsibility as heads of state is to protect and\nenhance the safety of our citizens. To do that, we must confront\nthe new challenges of our time -- and we must do it together.\n21\nFifty years ago, as the conference that gave birth to the United\nNations got underway in San Francisco, a young American war\nhero recorded his impressions for a newspaper. \"The average\nG.I. in the street doesn't seem to have a very clear-cut\nconception of what this meeting is about,\" young John F.\nKennedy wrote. \"But one bemedaled marine sergeant gave the\ngeneral reaction when he said: \"I. don't know much about what's\ngoing on -- but if they just fix it so that we don't have to fight\nany more -- they can count me in.\"\"\n22\nThe United Nations has not ended war. But it has made war less\nlikely and helped many nations turn from conflict to\ncooperation. The United Nations has not stopped human\nsuffering. But it has healed the wounds and lengthened the lives\nof millions. The United Nations has not banished repression or\npoverty from this earth. But it has advanced the cause of\nfreedom and prosperity on every continent. The United Nations\nhas not been all that we wished it would be. But it has been a\nforce for good and a bulwark against evil. In the twilight of our\ncentury -- marked by SO much progress and too much\nbloodshed witness to humanity's capacity for the best and its\nweakness for the worst -- we need the United Nations. And so,\nfor another fifty years and beyond, you can count the United\nStates in.",
        "objectFileSize": 565683,
        "objectFilename": "42-t-7585787-20060459F-014-008-2014.pdf",
        "objectId": "55259254",
        "objectType": "Portable Document File (PDF)",
        "objectUrl": "https://s3.amazonaws.com/NARAprodstorage/opastorage/live/98/9031/23903198/content/presidential-libraries/clinton/foia/2006/2006-0459-F/2006-0459-F-PDF/Box_014/42-t-7585787-20060459F-014-008-2014.pdf"
      }
    ],
    "generalRecordsTypes": [
      "Textual Records"
    ],
    "levelOfDescription": "fileUnit",
    "naId": 23903198,
    "otherTitles": [
      "42-t-7585787-20060459F-014-008-2014"
    ],
    "physicalOccurrences": [
      {
        "copyStatus": "Preservation-Reproduction-Reference",
        "mediaOccurrences": [
          {
            "containerId": "14",
            "generalMediaTypes": [
              "Loose Sheets"
            ],
            "specificMediaType": "Paper"
          }
        ],
        "referenceUnits": [
          {
            "address1": "1200 President Clinton Avenue",
            "city": "Little Rock",
            "email": "clinton.library@nara.gov",
            "fax": "501-244-2881",
            "mailCode": "LP-WJC",
            "name": "William J. Clinton Library",
            "phone": "501-244-2877",
            "postalCode": "72201",
            "state": "AR"
          }
        ]
      }
    ],
    "recordType": "description",
    "title": "UNGA Speech - Big Type",
    "useRestriction": {
      "note": "Some or all of the records may be subject to copyright restrictions. Researchers should contact the publisher for further information.",
      "specificUseRestrictions": [
        "Copyright"
      ],
      "status": "Restricted - Possibly"
    },
    "variantControlNumbers": [
      {
        "number": "LPWJC 2006-0459-F",
        "type": "FOIA Tracking Number"
      }
    ]
  },
  "nara_naId": 23903198,
  "other_titles": [
    "42-t-7585787-20060459F-014-008-2014"
  ],
  "parent_naId": 7585787,
  "physical_location": {
    "copyStatus": "Preservation-Reproduction-Reference",
    "mediaOccurrences": [
      {
        "containerId": "14",
        "generalMediaTypes": [
          "Loose Sheets"
        ],
        "specificMediaType": "Paper"
      }
    ],
    "referenceUnits": [
      {
        "address1": "1200 President Clinton Avenue",
        "city": "Little Rock",
        "email": "clinton.library@nara.gov",
        "fax": "501-244-2881",
        "mailCode": "LP-WJC",
        "name": "William J. Clinton Library",
        "phone": "501-244-2877",
        "postalCode": "72201",
        "state": "AR"
      }
    ]
  },
  "record_types": [
    "Textual Records"
  ],
  "schema": "nara-fileunit@v1",
  "title": "UNGA Speech - Big Type"
}
Parent
↑ 01K7JRF6H9WXSNM51NHS0RN9CC

Children (24)
01K7JRF71S35BHFJX542D8M4ZB
01K7JRF7F5YC3KP19G8GM24FQ2
01K7JRF7V9D24H0CJ0XTNQ209E
01K7JRF8F6GH1Q0KYGZ1K9PNQK
01K7JRF8WMNGHASGCPMJ9XDRF6
01K7JRF99KYNX0T58FEW5GNQK3
01K7JRF9PZ7329T8HDBDDXXZQR
01K7JRFA97BB1S2VTKVFB9J9Y5
01K7JRFAT8SVK1B8VPQ7B4G6VW
01K7JRFBHPQHPMWZ3QBXQT0J02
01K7JRFBWXW7CZM27XKRG0GTYR
01K7JRFC87FV4N63R38T38YYJQ
01K7JRFCMT98A4B7QT7S3NPSGC
01K7JRFD24B9A8VB9HN74994DD
01K7JRFDDSS1R52WNM4HS8M2ZT
01K7JRFDSHYPGSECJHQXTDC87Q
01K7JRFE475ZJ1TWGSW8XZEW2S
01K7JRFEFX33K9W3JPC367K5K4
01K7JRFF466NV7GX5J04QRZRBT
01K7JRFGC5X2QKXWCB8E8FN0VT
01K7JRFGXJ4A22WDB015PKAFX9
01K7JRFHDBCDZ92V0H0D7YTVB7
01K7JRFHVNHE28EQK9K8683JQN
01K7JRFJABSVB1PGY4PDGP3X4R
← Home


# NARA Arke IPFS Metadata Structure & Semantic Search Analysis

## Executive Summary

This document analyzes the metadata structure of NARA collections imported into Arke IPFS, with a focus on identifying fields suitable for semantic search and vector embedding. The analysis is based on real imported data from the WJC-NSCSW (Clinton NSC Speechwriting Office) collection.

**Key Finding**: Semantic richness varies dramatically across entity levels, with **FileUnits** and **DigitalObjects** (especially PDFs with OCR text) containing the most valuable data for semantic search. Institution and Collection levels have minimal semantic content.

---

## Hierarchical Structure Overview

```
Arke Genesis Block (PI: 00000000000000000000000000)
└── Institution (e.g., National Archives)
    └── Collection (e.g., WJC-NSCSW Collection, naId: 7388842)
        └── Series (e.g., Antony Blinken's Files, naId: 7585787)
            └── FileUnit (e.g., "Lake - California Trip 8/6/96", naId: 23903425)
                └── DigitalObject (e.g., PDF Page with OCR text, objectId: 55265474)
```

Each entity:
- Has a ULID-based Persistent Identifier (PI) auto-generated by Arke API
- Stores catalog metadata in IPFS as dag-json (referenced by CID in entity's `components` field)
- Maintains bidirectional parent-child relationships via `parent_pi` and `children_pi` arrays
- Tracks NARA identifiers (naId or objectId) for provenance

---

## Level-by-Level Analysis

### 1. Arke Genesis Block

**Purpose**: Root of the entire archive tree

**Fields**:
- `pi`: "00000000000000000000000000" (fixed)
- `ver`: Version number
- `ts`: Timestamp
- `children_pi`: Array of all Institution PIs

**Semantic Richness**: ⭐☆☆☆☆ (None)

**Analysis**:
This is purely a structural anchor with no descriptive metadata. It serves as the universal root for all institutions in the system.

**Semantic Search Potential**: None - this is not a searchable entity.

---

### 2. Institution

**Schema**: `nara-institution@v1`

**Example**:
```json
{
  "schema": "nara-institution@v1",
  "name": "National Archives",
  "description": "National Archives and Records Administration",
  "url": "https://www.archives.gov/",
  "import_timestamp": "2025-10-15T01:41:31.348020Z"
}
```

**Fields**:
- `name` (required): Institution name
- `description` (optional): Brief description
- `url` (optional): Website URL
- `location` (optional): Physical location [not in current data]
- `import_timestamp`: When imported

**Semantic Richness**: ⭐⭐☆☆☆ (Minimal)

**Semantically Rich Fields**:
1. **`name`** - Short, proper noun (e.g., "National Archives")
   - **Use**: Entity recognition, institution-level filtering
   - **Vector embedding value**: Low - too short and generic

2. **`description`** - One sentence description
   - **Use**: Provides institutional context
   - **Vector embedding value**: Low-moderate - usually generic boilerplate

**Analysis**:
Institutions have very limited descriptive metadata. The name and description are typically standardized/formal and don't contain rich semantic content. These entities serve primarily as organizational containers rather than discoverable content.

**Semantic Search Potential**: Low - Better suited for exact match/faceted filtering rather than vector search.

**Universal Fields**: `name`, `description` (short text descriptions)

---

### 3. Collection

**Schema**: `nara-collection@v1`

**Example**:
```json
{
  "schema": "nara-collection@v1",
  "nara_naId": 7388842,
  "collection_identifier": "WJC-NSCSW",
  "title": "Records of the National Security Council Speechwriting Office (Clinton Administration)",
  "date_range": {
    "start": "1993-01-01",
    "end": "2001-12-31"
  },
  "import_timestamp": "2025-10-15T01:41:33.209998Z"
}
```

**Fields**:
- `nara_naId` (required): NARA collection identifier (integer)
- `collection_identifier` (required): Short collection code (e.g., "WJC-NSCSW")
- `title` (required): Full collection title
- `date_range` (required): Temporal coverage with start/end dates
- `stats` (optional): Statistics like total series, file units [not in current data]
- `nara_full_metadata` (optional): Complete NARA record [not in current data]
- `import_timestamp`: When imported

**Semantic Richness**: ⭐⭐⭐☆☆ (Moderate)

**Semantically Rich Fields**:
1. **`title`** - Descriptive collection title (1-2 sentences)
   - **Example**: "Records of the National Security Council Speechwriting Office (Clinton Administration)"
   - **Use**: Provides topical and temporal context
   - **Vector embedding value**: Moderate - describes scope but still high-level

2. **`date_range`** - Temporal boundaries
   - **Use**: Temporal filtering, contextual enrichment
   - **Vector embedding value**: Low as standalone; moderate when combined with title

3. **`collection_identifier`** - Short code
   - **Use**: Exact matching, citation
   - **Vector embedding value**: None - alphanumeric code

**Analysis**:
Collections provide more context than Institutions but are still relatively high-level. The title is the primary semantic field, offering subject matter and temporal scope. The date_range is valuable for temporal queries but doesn't carry inherent semantic meaning without context.

**Semantic Search Potential**: Moderate - Titles are descriptive enough for broad topical queries but lack the granularity of lower-level entities.

**Universal Fields**: `title`, `date_range` (appear at Collection, Series, FileUnit levels)

---

### 4. Series

**Schema**: `nara-series@v1`

**Example**:
```json
{
  "schema": "nara-series@v1",
  "nara_naId": 7585787,
  "parent_naId": 7388842,
  "title": "Antony Blinken's Files",
  "date_range": {
    "start": "1994-01-01",
    "end": "1998-12-31"
  },
  "creators": [
    {
      "abolishDate": {
        "logicalDate": "2001-12-31",
        "year": 2001
      },
      "authorityType": "organization",
      "creatorType": "Most Recent",
      "establishDate": {
        "logicalDate": "1993-01-01",
        "year": 1993
      },
      "heading": "President (1993-2001 : Clinton). National Security Council. (1993 - 2001)",
      "naId": 10500730
    }
  ],
  "import_timestamp": "2025-10-15T01:41:33.343685Z"
}
```

**Fields**:
- `nara_naId` (required): NARA series identifier
- `parent_naId` (required): Parent collection's naId
- `title` (required): Series title
- `date_range` (required): Temporal coverage
- `creators` (optional): Array of creator entities (persons/organizations)
- `nara_full_metadata` (optional): Complete NARA record [not in current data]
- `import_timestamp`: When imported

**Semantic Richness**: ⭐⭐⭐⭐☆ (Good)

**Semantically Rich Fields**:
1. **`title`** - Series name, often includes person or topic
   - **Example**: "Antony Blinken's Files"
   - **Use**: Identifies responsible party or subject area
   - **Vector embedding value**: Moderate-good - more specific than collection titles

2. **`creators`** - Structured creator metadata
   - **Subfields**:
     - `heading`: Formal name with dates (e.g., "President (1993-2001 : Clinton). National Security Council. (1993 - 2001)")
     - `authorityType`: "organization" or "person"
     - `creatorType`: "Most Recent", etc.
     - `establishDate`/`abolishDate`: Temporal bounds
   - **Use**: Authority control, provenance tracking, contextual enrichment
   - **Vector embedding value**: Good - provides rich organizational/personal context

3. **`date_range`** - Narrower than collection-level dates
   - **Use**: Temporal filtering within collection
   - **Vector embedding value**: Moderate when combined with other fields

**Analysis**:
Series provide significantly more semantic value than Collections. The combination of a specific title (often including personal names) and structured creator information offers good context. The `creators.heading` field is particularly valuable as it includes hierarchical organizational information.

**Semantic Search Potential**: Good - The title and creator information are specific enough for meaningful semantic queries. Useful for queries like "documents related to Antony Blinken" or "National Security Council records."

**Universal Fields**: `title`, `date_range` (shared with Collection/FileUnit), `creators` (unique to Series)

---

### 5. FileUnit

**Schema**: `nara-fileunit@v1`

**Example** (abbreviated for clarity):
```json
{
  "schema": "nara-fileunit@v1",
  "nara_naId": 23903425,
  "parent_naId": 7585787,
  "collection_naId": 7388842,
  "title": "Lake - California Trip 8/6/96",
  "level": "fileUnit",
  "record_types": ["Textual Records"],
  "digital_object_count": 4,
  "access_restriction": {
    "note": "These records may need to be screened for personal privacy...",
    "specificAccessRestrictions": [
      {
        "restriction": "FOIA (b)(1) National Security",
        "securityClassification": "Secret"
      },
      { "restriction": "FOIA (b)(6) Personal Information" }
    ],
    "status": "Restricted - Partly"
  },
  "foia_tracking": "LPWJC 2006-0459-F",
  "physical_location": {
    "copyStatus": "Preservation-Reproduction-Reference",
    "mediaOccurrences": [
      {
        "containerId": "23",
        "generalMediaTypes": ["Loose Sheets"],
        "specificMediaType": "Paper"
      }
    ],
    "referenceUnits": [
      {
        "name": "William J. Clinton Library",
        "address1": "1200 President Clinton Avenue",
        "city": "Little Rock",
        "state": "AR",
        "postalCode": "72201",
        "email": "clinton.library@nara.gov"
      }
    ]
  },
  "other_titles": ["42-t-7585787-20060459F-023-028-2014"],
  "nara_full_metadata": { /* Complete NARA record with ancestors, digital objects, etc. */ },
  "import_timestamp": "2025-10-15T01:47:33.869578Z"
}
```

**Fields**:
- `nara_naId` (required): NARA file unit identifier
- `parent_naId` (required): Parent series naId
- `collection_naId` (required): Root collection naId
- `title` (required): File unit title
- `level`: "fileUnit" (constant)
- `record_types` (required): Types of records (e.g., ["Textual Records", "Photographs"])
- `digital_object_count` (required): Number of digital objects (pages)
- `access_restriction` (optional): Detailed restriction information
- `foia_tracking` (optional): FOIA request tracking number
- `physical_location` (optional): Physical storage details
- `other_titles` (optional): Alternate titles/identifiers
- `nara_full_metadata` (optional): Complete original NARA metadata including ancestors and digitalObjects array
- `import_timestamp`: When imported

**Semantic Richness**: ⭐⭐⭐⭐⭐ (Excellent)

**Semantically Rich Fields**:

1. **`title`** - Highly specific, descriptive document titles
   - **Examples**:
     - "Lake - California Trip 8/6/96"
     - "Gulf War Illness Insert 2/26/97"
     - "Denver - Social Dinner Toast 6/21/97"
   - **Characteristics**: Often includes person names, event types, locations, dates
   - **Use**: Primary discovery field - users search by topic, person, event
   - **Vector embedding value**: EXCELLENT - Rich semantic content with entities (people, places, events, dates)

2. **`other_titles`** - Alternate identifiers/titles
   - **Example**: "42-t-7585787-20060459F-023-028-2014"
   - **Use**: Finding aids, box/folder identifiers
   - **Vector embedding value**: Low - usually alphanumeric codes

3. **`record_types`** - Document format types
   - **Examples**: "Textual Records", "Photographs", "Sound Recordings"
   - **Use**: Format faceting, user filtering by media type
   - **Vector embedding value**: Low - better as categorical filter

4. **`access_restriction`** - Detailed restriction metadata
   - **Subfields**:
     - `note`: Explanation of restrictions (paragraph of text)
     - `specificAccessRestrictions[].restriction`: FOIA exemption categories
     - `specificAccessRestrictions[].securityClassification`: Classification level (e.g., "Secret", "Top Secret")
     - `status`: Overall status (e.g., "Restricted - Partly", "Unrestricted")
   - **Example note**: "These records may need to be screened for personal privacy, and law enforcement under 5 U.S.C. 552 (b) prior to public release."
   - **Use**: Access control, legal compliance, contextual understanding
   - **Vector embedding value**: Moderate - the `note` field contains meaningful text; restriction types are categorical

5. **`foia_tracking`** - FOIA request identifier
   - **Example**: "LPWJC 2006-0459-F"
   - **Use**: Administrative tracking, grouping related releases
   - **Vector embedding value**: None - alphanumeric code

6. **`physical_location`** - Physical storage and contact information
   - **Subfields**: Box/container numbers, media types, holding repository details
   - **Use**: Physical access, provenance
   - **Vector embedding value**: Low-moderate - repository names and locations have some semantic value

7. **`nara_full_metadata`** - Complete NARA record (HUGE)
   - **Contains**:
     - Full ancestor chain with complete metadata
     - Complete digitalObjects array with extractedText for PDFs
     - useRestriction details
     - variantControlNumbers
     - physicalOccurrences
   - **Use**: Preservation, deep analysis, extracting additional fields not in simplified schema
   - **Vector embedding value**: HIGH potential - contains extractedText from PDFs buried in digitalObjects array

**Analysis**:
FileUnits are the **primary semantic payload** of the archive. Titles are highly descriptive and contain multiple semantic entities (people, places, events, dates). The access_restriction notes provide contextual information about sensitivity. Most importantly, the `nara_full_metadata` field contains the complete NARA record including OCR text from PDF objects.

**Semantic Search Potential**: EXCELLENT - This is the primary discovery layer. Users will search for:
- Specific people ("Anthony Lake", "Antony Blinken")
- Topics ("California trip", "Gulf War", "social dinner")
- Locations ("Denver", "San Diego")
- Document types combined with subjects ("speech on Haiti")
- FOIA categories/restrictions

**Critical Discovery**: The `nara_full_metadata.digitalObjects[].extractedText` field contains full OCR text from PDFs. This is the richest semantic data but is buried in the full_metadata blob. See DigitalObject section below.

**Universal Fields**: `title` (shared across Collection/Series/FileUnit), `nara_full_metadata` (shared across Collection/Series/FileUnit/DigitalObject - optional but incredibly valuable)

---

### 6. DigitalObject

**Schema**: `nara-digitalobject@v1`

**Example** (Image - no OCR):
```json
{
  "schema": "nara-digitalobject@v1",
  "nara_objectId": "55265474",
  "parent_naId": 23903425,
  "filename": "42_t_7585787_20060459F_023_028_2016_Page_001.JPG",
  "object_type": "Image (JPG)",
  "file_size": 393216,
  "page_number": 1,
  "s3_url": "https://s3.amazonaws.com/NARAprodstorage/...",
  "content_hash": {
    "algorithm": "sha256",
    "digest_hex": "3a39ec8dc6df22a194590ac34c8897d3a65000d2a4bc1a4b4bfa2cb334332b23"
  },
  "import_timestamp": "2025-10-15T01:47:34.458569Z"
}
```

**Example** (PDF with OCR text):
```json
{
  "schema": "nara-digitalobject@v1",
  "nara_objectId": "55265473",
  "parent_naId": 23903425,
  "filename": "42-t-7585787-20060459F-023-028-2014.pdf",
  "object_type": "Portable Document File (PDF)",
  "file_size": 100569,
  "page_number": 4,
  "extracted_text": "\nCase Number: 2006-0459-F\nFOIA\nMARKER\nThis is not a textual record...\n\nMEMORANDUM FOR ANTHONY LAKE\ncc: Nancy Soderberg, Antony Blinken\nFrom: Julia Moffett\nSubject: California Trip\n\nI have attached a list of options for forums and other events that could comprise a solid, two-day trip to California. If possible, we need to come to closure on Monday in order to make these appearances successful...\n\n[continues for several paragraphs with detailed trip planning information]",
  "s3_url": "https://s3.amazonaws.com/NARAprodstorage/...",
  "content_hash": {
    "algorithm": "sha256",
    "digest_hex": "..."
  },
  "import_timestamp": "2025-10-15T01:47:35.789012Z"
}
```

**Fields**:
- `nara_objectId` (required): NARA digital object identifier
- `parent_naId` (required): Parent file unit naId
- `filename` (required): Original filename
- `object_type` (required): File format (e.g., "Image (JPG)", "Portable Document File (PDF)")
- `file_size` (required): Size in bytes
- `page_number` (optional): Page/sequence number within file unit
- `s3_url` (required): S3 URL for retrieval (image/PDF NOT stored in IPFS)
- `content_hash` (required): SHA256 hash for verification
- `extracted_text` (optional): OCR text from NARA (PDFs and some images)
- `nara_full_metadata` (optional): Complete NARA object metadata
- `import_timestamp`: When imported

**Semantic Richness**: ⭐⭐⭐⭐⭐ (Excellent - when `extracted_text` is present)

**Semantically Rich Fields**:

1. **`extracted_text`** - Full OCR text from document (when available)
   - **Availability**: Present in PDFs and some processed images from NARA
   - **Content**: Complete transcription of document text
   - **Example content**:
     - Memorandum headers (FROM, TO, SUBJECT, DATE)
     - Full body text with detailed planning, analysis, recommendations
     - Proper names (people, places, organizations)
     - Dates, events, topics
     - Policy discussions, briefing materials, correspondence
   - **Use**: THE PRIMARY FULL-TEXT SEARCH FIELD
   - **Vector embedding value**: MAXIMUM - This is the richest semantic data in the entire system
   - **Volume**: Can be multi-page documents with thousands of words

2. **`filename`** - File naming convention
   - **Pattern**: Often includes box numbers, dates, page numbers
   - **Example**: "42_t_7585787_20060459F_023_028_2016_Page_001.JPG"
   - **Use**: Administrative tracking, page ordering
   - **Vector embedding value**: Low - mostly technical identifiers

3. **`object_type`** - File format
   - **Examples**: "Image (JPG)", "Portable Document File (PDF)", "TIFF Image"
   - **Use**: Format filtering, determining if text extraction is available
   - **Vector embedding value**: None - categorical filter

4. **`page_number`** - Sequence within document
   - **Use**: Ordering, citation
   - **Vector embedding value**: None - numeric

**Analysis**:
DigitalObjects represent individual pages/files within a FileUnit. Their semantic value varies dramatically:

- **JPG/TIF images without OCR**: Very low semantic value (just metadata)
- **PDFs or images with OCR**: MAXIMUM semantic value - contains full document text

The `extracted_text` field is the **single most valuable field for semantic search** across the entire system. It contains the actual content users are seeking - memos, briefings, correspondence, policy documents, etc. This text includes:
- Author/recipient names
- Subject matter in detail
- Dates and events
- Policy discussions
- Recommendations and analysis
- Meeting notes
- Talking points

**Critical Note**: Not all DigitalObjects have `extracted_text`. Coverage depends on:
- NARA's OCR processing (PDFs more likely than images)
- Document quality
- Historical processing decisions

**Semantic Search Potential**: MAXIMUM (when extracted_text is present)

This is where users will find what they're actually looking for. Queries like:
- "memo about California trip planning"
- "briefing on Gulf War illness"
- "discussion of national security issues"
- "correspondence with Nancy Soderberg"

All of these would match against the full-text content in `extracted_text`.

**Universal Fields**: `filename`, `extracted_text` (when available - this is THE universal semantic payload)

---

## Universal Fields Across All Levels

### Fields Present at Multiple Levels:

1. **`title`** (Collection, Series, FileUnit)
   - Semantic value increases as you descend hierarchy
   - Collection: Broad organizational scope
   - Series: Specific person/office
   - FileUnit: Specific document/topic

2. **`date_range`** (Collection, Series) / Implicit in FileUnit titles
   - Temporal boundaries narrow at each level
   - Use: Temporal filtering, contextual enrichment

3. **`nara_full_metadata`** (Collection, Series, FileUnit, DigitalObject - optional)
   - Contains complete original NARA metadata
   - Most valuable at FileUnit level (includes digitalObjects array with extractedText)
   - Use: Deep analysis, extracting fields not in simplified schema

4. **`import_timestamp`** (All levels)
   - Administrative metadata
   - No semantic value

5. **NARA Identifiers**: `nara_naId` (Collection, Series, FileUnit) / `nara_objectId` (DigitalObject)
   - Administrative tracking
   - No semantic value, but critical for provenance

### Universal Semantic Pattern:

**Structured metadata** → **Descriptive titles** → **Full text content**

- Higher levels (Institution, Collection) provide organizational context
- Middle level (Series) adds creator/provenance context
- Lower levels (FileUnit, DigitalObject) contain discoverable content

---

## Semantic Search Strategy Recommendations

### Tier 1: Primary Search Targets (Highest Value)

1. **DigitalObject.extracted_text**
   - **Why**: Full document text - the actual content users seek
   - **Approach**: Full-text vector embeddings, chunk into passages if documents are long
   - **Coverage**: Variable (PDFs > images)

2. **FileUnit.title**
   - **Why**: Highly descriptive, contains entities (people, places, events)
   - **Approach**: Vector embedding of complete title
   - **Coverage**: Universal

### Tier 2: Secondary Search Targets (Good Value)

3. **FileUnit.access_restriction.note**
   - **Why**: Contextual information about document sensitivity
   - **Approach**: Include in FileUnit composite embedding or separate index
   - **Coverage**: Partial (only restricted documents)

4. **Series.title + Series.creators.heading**
   - **Why**: Provides creator and organizational context
   - **Approach**: Composite embedding or separate facet
   - **Coverage**: Universal

5. **Collection.title**
   - **Why**: Broad topical context
   - **Approach**: Metadata enrichment for lower-level entities
   - **Coverage**: Universal

### Tier 3: Metadata Filters (Low Semantic Value, High Filter Value)

6. **record_types** (FileUnit)
   - **Approach**: Categorical filter

7. **object_type** (DigitalObject)
   - **Approach**: Categorical filter

8. **date_range** (Collection, Series)
   - **Approach**: Temporal range filter

9. **access_restriction.status** (FileUnit)
   - **Approach**: Categorical filter (Unrestricted / Restricted - Partly / Restricted - Fully)

### Not Recommended for Semantic Search:

- Institution.name / Institution.description (too generic, better as facets)
- NARA IDs (naId, objectId) - administrative only
- Filenames - technical identifiers
- Import timestamps - administrative metadata
- Content hashes - verification only

---


## Fields Summary Table

| Level | Field | Type | Semantic Richness | Vector Embedding | Use Case |
|-------|-------|------|-------------------|------------------|----------|
| **Institution** | name | Short text | ⭐☆☆☆☆ | No | Facet filter |
| | description | 1 sentence | ⭐⭐☆☆☆ | No | Contextual display |
| **Collection** | title | 1-2 sentences | ⭐⭐⭐☆☆ | Possible | Broad topical queries |
| | date_range | Dates | ⭐☆☆☆☆ | No | Temporal filter |
| **Series** | title | Short text | ⭐⭐⭐⭐☆ | Yes | Creator/office queries |
| | creators.heading | Structured text | ⭐⭐⭐⭐☆ | Yes | Authority/provenance |
| | date_range | Dates | ⭐☆☆☆☆ | No | Temporal filter |
| **FileUnit** | title | 1 sentence | ⭐⭐⭐⭐⭐ | YES | Primary discovery |
| | access_restriction.note | Paragraph | ⭐⭐⭐☆☆ | Yes | Contextual info |
| | record_types | Categorical | ⭐☆☆☆☆ | No | Format filter |
| | foia_tracking | Code | ☆☆☆☆☆ | No | Administrative |
| **DigitalObject** | extracted_text | Multi-paragraph | ⭐⭐⭐⭐⭐ | YES | Full-text search |
| | filename | Technical | ☆☆☆☆☆ | No | Administrative |
| | object_type | Categorical | ☆☆☆☆☆ | No | Format filter |

**Key**:
- ⭐⭐⭐⭐⭐ = Excellent semantic richness, primary search target
- ⭐⭐⭐⭐☆ = Good semantic richness, secondary search target
- ⭐⭐⭐☆☆ = Moderate semantic richness, useful for enrichment
- ⭐⭐☆☆☆ = Minimal semantic richness, better as filter
- ⭐☆☆☆☆ = Very low semantic richness, metadata only
- ☆☆☆☆☆ = No semantic richness, administrative only

---

## Conclusion

The NARA Arke IPFS metadata structure has a clear semantic gradient:

1. **Top levels (Institution, Collection)**: Organizational structure, minimal semantic content
2. **Middle level (Series)**: Creator/provenance context, moderate semantic value
3. **Bottom levels (FileUnit, DigitalObject)**: Content layer, maximum semantic value

**The golden fields for semantic search are**:
- **`DigitalObject.extracted_text`** - Full document text (when available)
- **`FileUnit.title`** - Descriptive document titles

**The universal pattern across good semantic fields is**: They contain natural language descriptions of **who, what, when, where** rather than technical identifiers or categorical codes.

For effective semantic search implementation, focus vector embedding efforts on Tier 1 fields (extracted_text, FileUnit.title) and use Tier 2-3 fields for metadata enrichment and filtering.




# Upsert vectors

> The `upsert` operation writes vectors into a namespace. If a new value is upserted for an existing vector ID, it will overwrite the previous value.

For guidance, examples, and limits, see [Upsert data](https://docs.pinecone.io/guides/index-data/upsert-data).

## OpenAPI

````yaml https://raw.githubusercontent.com/pinecone-io/pinecone-api/refs/heads/main/2024-07/data_2024-07.oas.yaml post /vectors/upsert
paths:
  path: /vectors/upsert
  method: post
  servers:
    - url: https://{index_host}
      variables:
        index_host:
          type: string
          description: host of the index
          default: unknown
  request:
    security:
      - title: ApiKeyAuth
        parameters:
          query: {}
          header:
            Api-Key:
              type: apiKey
              description: >-
                An API Key is required to call Pinecone APIs. Get yours from the
                [console](https://app.pinecone.io/).
          cookie: {}
    parameters:
      path: {}
      query: {}
      header: {}
      cookie: {}
    body:
      application/json:
        schemaArray:
          - type: object
            properties:
              vectors:
                allOf:
                  - description: >-
                      An array containing the vectors to upsert. Recommended
                      batch limit is up to 1000 vectors.
                    type: array
                    required:
                      - vectors
                    items:
                      $ref: '#/components/schemas/Vector'
                    minLength: 1
                    maxLength: 1000
              namespace:
                allOf:
                  - example: example-namespace
                    description: The namespace where you upsert vectors.
                    type: string
            required: true
            description: The request for the `upsert` operation.
            refIdentifier: '#/components/schemas/UpsertRequest'
            requiredProperties:
              - vectors
        examples:
          example:
            value:
              vectors:
                - id: example-vector-1
                  values:
                    - 0.1
                    - 0.2
                    - 0.3
                    - 0.4
                    - 0.5
                    - 0.6
                    - 0.7
                    - 0.8
                  sparseValues:
                    indices:
                      - 1
                      - 312
                      - 822
                      - 14
                      - 980
                    values:
                      - 0.1
                      - 0.2
                      - 0.3
                      - 0.4
                      - 0.5
                  metadata:
                    genre: documentary
                    year: 2019
              namespace: example-namespace
  response:
    '200':
      application/json:
        schemaArray:
          - type: object
            properties:
              upsertedCount:
                allOf:
                  - example: 2
                    description: The number of vectors upserted.
                    type: integer
                    format: int64
            description: The response for the `upsert` operation.
            refIdentifier: '#/components/schemas/UpsertResponse'
        examples:
          example:
            value:
              upsertedCount: 2
        description: A successful response.
    '400':
      application/json:
        schemaArray:
          - type: object
            properties:
              code:
                allOf:
                  - &ref_0
                    type: integer
                    format: int32
              message:
                allOf:
                  - &ref_1
                    type: string
              details:
                allOf:
                  - &ref_2
                    type: array
                    items:
                      $ref: '#/components/schemas/protobufAny'
            refIdentifier: '#/components/schemas/rpcStatus'
        examples:
          example:
            value:
              code: 123
              message: <string>
              details:
                - typeUrl: <string>
                  value: aSDinaTvuI8gbWludGxpZnk=
        description: Bad request. The request body included invalid request parameters.
    default:
      application/json:
        schemaArray:
          - type: object
            properties:
              code:
                allOf:
                  - *ref_0
              message:
                allOf:
                  - *ref_1
              details:
                allOf:
                  - *ref_2
            refIdentifier: '#/components/schemas/rpcStatus'
        examples:
          example:
            value:
              code: 123
              message: <string>
              details:
                - typeUrl: <string>
                  value: aSDinaTvuI8gbWludGxpZnk=
        description: An unexpected error response.
  deprecated: false
  type: path
components:
  schemas:
    SparseValues:
      description: >-
        Vector sparse data. Represented as a list of indices and a list of 
        corresponded values, which must be with the same length.      
      type: object
      properties:
        indices:
          example:
            - 1
            - 312
            - 822
            - 14
            - 980
          description: The indices of the sparse data.
          type: array
          required:
            - indices
          items:
            type: integer
            format: int64
          minLength: 1
          maxLength: 1000
        values:
          example:
            - 0.1
            - 0.2
            - 0.3
            - 0.4
            - 0.5
          description: >-
            The corresponding values of the sparse data, which must be with the
            same length as the indices.
          type: array
          required:
            - values
          items:
            type: number
            format: float
          minLength: 1
          maxLength: 1000
      required:
        - indices
        - values
    Vector:
      type: object
      properties:
        id:
          example: example-vector-1
          description: This is the vector's unique id.
          type: string
          required:
            - id
          minLength: 1
          maxLength: 512
        values:
          example:
            - 0.1
            - 0.2
            - 0.3
            - 0.4
            - 0.5
            - 0.6
            - 0.7
            - 0.8
          description: This is the vector data included in the request.
          type: array
          required:
            - values
          items:
            type: number
            format: float
          minLength: 1
          maxLength: 20000
        sparseValues:
          $ref: '#/components/schemas/SparseValues'
        metadata:
          example:
            genre: documentary
            year: 2019
          description: This is the metadata included in the request.
          type: object
      required:
        - id
        - values
    protobufAny:
      type: object
      properties:
        typeUrl:
          type: string
        value:
          type: string
          format: byte

````
// npm install @pinecone-database/pinecone
import { Pinecone } from '@pinecone-database/pinecone'

const pc = new Pinecone({ apiKey: "YOUR_API_KEY" })
const index = pc.index("docs-example")

await index.namespace('example-namespace').upsert([
  {
    id: 'vec1',
    values: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    sparseValues: {
        indices: [1, 5],
        values: [0.5, 0.5]
    },
    metadata: {'genre': 'drama'},
  },
  {
    id: 'vec2',
    values: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
    metadata: {'genre': 'action'},
    sparseValues: {
        indices: [5, 6],
        values: [0.4, 0.5]
    }
  }
])

# Update a vector

> The `update` operation updates a vector in a namespace. If a value is included, it will overwrite the previous value. If a `set_metadata` is included, the values of the fields specified in it will be added or overwrite the previous value.

For guidance and examples, see [Update data](https://docs.pinecone.io/guides/manage-data/update-data).

## OpenAPI

````yaml https://raw.githubusercontent.com/pinecone-io/pinecone-api/refs/heads/main/2024-07/data_2024-07.oas.yaml post /vectors/update
paths:
  path: /vectors/update
  method: post
  servers:
    - url: https://{index_host}
      variables:
        index_host:
          type: string
          description: host of the index
          default: unknown
  request:
    security:
      - title: ApiKeyAuth
        parameters:
          query: {}
          header:
            Api-Key:
              type: apiKey
              description: >-
                An API Key is required to call Pinecone APIs. Get yours from the
                [console](https://app.pinecone.io/).
          cookie: {}
    parameters:
      path: {}
      query: {}
      header: {}
      cookie: {}
    body:
      application/json:
        schemaArray:
          - type: object
            properties:
              id:
                allOf:
                  - example: example-vector-1
                    description: Vector's unique id.
                    type: string
                    required:
                      - id
                    minLength: 1
                    maxLength: 512
              values:
                allOf:
                  - example:
                      - 0.1
                      - 0.2
                      - 0.3
                      - 0.4
                      - 0.5
                      - 0.6
                      - 0.7
                      - 0.8
                    description: Vector data.
                    type: array
                    items:
                      type: number
                      format: float
                    minLength: 1
                    maxLength: 20000
              sparseValues:
                allOf:
                  - $ref: '#/components/schemas/SparseValues'
              setMetadata:
                allOf:
                  - example:
                      genre: documentary
                      year: 2019
                    description: Metadata to set for the vector.
                    type: object
              namespace:
                allOf:
                  - example: example-namespace
                    description: The namespace containing the vector to update.
                    type: string
            required: true
            description: The request for the `update` operation.
            refIdentifier: '#/components/schemas/UpdateRequest'
            requiredProperties:
              - id
        examples:
          example:
            value:
              id: example-vector-1
              values:
                - 0.1
                - 0.2
                - 0.3
                - 0.4
                - 0.5
                - 0.6
                - 0.7
                - 0.8
              sparseValues:
                indices:
                  - 1
                  - 312
                  - 822
                  - 14
                  - 980
                values:
                  - 0.1
                  - 0.2
                  - 0.3
                  - 0.4
                  - 0.5
              setMetadata:
                genre: documentary
                year: 2019
              namespace: example-namespace
  response:
    '200':
      application/json:
        schemaArray:
          - type: object
            properties: {}
            description: The response for the `update` operation.
            refIdentifier: '#/components/schemas/UpdateResponse'
        examples:
          example:
            value: {}
        description: A successful response.
    '400':
      application/json:
        schemaArray:
          - type: object
            properties:
              code:
                allOf:
                  - &ref_0
                    type: integer
                    format: int32
              message:
                allOf:
                  - &ref_1
                    type: string
              details:
                allOf:
                  - &ref_2
                    type: array
                    items:
                      $ref: '#/components/schemas/protobufAny'
            refIdentifier: '#/components/schemas/rpcStatus'
        examples:
          example:
            value:
              code: 123
              message: <string>
              details:
                - typeUrl: <string>
                  value: aSDinaTvuI8gbWludGxpZnk=
        description: Bad request. The request body included invalid request parameters.
    default:
      application/json:
        schemaArray:
          - type: object
            properties:
              code:
                allOf:
                  - *ref_0
              message:
                allOf:
                  - *ref_1
              details:
                allOf:
                  - *ref_2
            refIdentifier: '#/components/schemas/rpcStatus'
        examples:
          example:
            value:
              code: 123
              message: <string>
              details:
                - typeUrl: <string>
                  value: aSDinaTvuI8gbWludGxpZnk=
        description: An unexpected error response.
  deprecated: false
  type: path
components:
  schemas:
    SparseValues:
      description: >-
        Vector sparse data. Represented as a list of indices and a list of 
        corresponded values, which must be with the same length.      
      type: object
      properties:
        indices:
          example:
            - 1
            - 312
            - 822
            - 14
            - 980
          description: The indices of the sparse data.
          type: array
          required:
            - indices
          items:
            type: integer
            format: int64
          minLength: 1
          maxLength: 1000
        values:
          example:
            - 0.1
            - 0.2
            - 0.3
            - 0.4
            - 0.5
          description: >-
            The corresponding values of the sparse data, which must be with the
            same length as the indices.
          type: array
          required:
            - values
          items:
            type: number
            format: float
          minLength: 1
          maxLength: 1000
      required:
        - indices
        - values
    protobufAny:
      type: object
      properties:
        typeUrl:
          type: string
        value:
          type: string
          format: byte

````

// npm install @pinecone-database/pinecone
import { Pinecone } from '@pinecone-database/pinecone'

const pc = new Pinecone({ apiKey: "YOUR_API_KEY" })
const index = pc.index("docs-example")

await index.namespace('example-namespace').update({
  id: 'id-3',
  values: [4.0, 2.0],
  metadata: {
    genre: "comedy",
  },
});


# List indexes

> This operation returns a list of all indexes in a project.

## OpenAPI

````yaml https://raw.githubusercontent.com/pinecone-io/pinecone-api/refs/heads/main/2024-07/control_2024-07.oas.yaml get /indexes
paths:
  path: /indexes
  method: get
  servers:
    - url: https://api.pinecone.io
      description: Production API endpoints
  request:
    security:
      - title: ApiKeyAuth
        parameters:
          query: {}
          header:
            Api-Key:
              type: apiKey
              description: >-
                An API Key is required to call Pinecone APIs. Get yours from the
                [console](https://app.pinecone.io/).
          cookie: {}
    parameters:
      path: {}
      query: {}
      header: {}
      cookie: {}
    body: {}
  response:
    '200':
      application/json:
        schemaArray:
          - type: object
            properties:
              indexes:
                allOf:
                  - type: array
                    items:
                      $ref: '#/components/schemas/IndexModel'
            description: The list of indexes that exist in the project.
            refIdentifier: '#/components/schemas/IndexList'
        examples:
          multiple-indexes:
            summary: A list containing one serverless index and one pod-based index.
            value:
              indexes:
                - dimension: 384
                  host: semantic-search-c01b5b5.svc.us-west1-gcp.pinecone.io
                  metric: cosine
                  name: semantic-search
                  spec:
                    pod:
                      environment: us-west1-gcp
                      pod_type: p1.x1
                      pods: 4
                      replicas: 2
                      shards: 2
                  status:
                    ready: true
                    state: Ready
                - dimension: 200
                  host: image-search-a31f9c1.svc.us-east1-gcp.pinecone.io
                  metric: dotproduct
                  name: image-search
                  spec:
                    serverless:
                      cloud: aws
                      region: us-east-1
                  status:
                    ready: false
                    state: Initializing
          one-index:
            summary: A list containing one serverless index.
            value:
              indexes:
                - dimension: 1536
                  host: movie-embeddings-c01b5b5.svc.us-east1-gcp.pinecone.io
                  metric: cosine
                  name: movie-embeddings
                  spec:
                    serverless:
                      cloud: aws
                      region: us-east-1
                  status:
                    ready: false
                    state: Initializing
          no-indexes:
            summary: No indexes created yet.
            value:
              indexes: []
        description: >-
          This operation returns a list of all the indexes that you have
          previously created, and which are associated with the given project
    '401':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - &ref_0
                    example: 500
                    description: The HTTP status code of the error.
                    type: integer
              error:
                allOf:
                  - &ref_1
                    example:
                      code: INVALID_ARGUMENT
                      message: >-
                        Index name must contain only lowercase alphanumeric
                        characters or hyphens, and must not begin or end with a
                        hyphen.
                    description: Detailed information about the error that occurred.
                    type: object
                    properties:
                      code:
                        type: string
                        enum:
                          - OK
                          - UNKNOWN
                          - INVALID_ARGUMENT
                          - DEADLINE_EXCEEDED
                          - QUOTA_EXCEEDED
                          - NOT_FOUND
                          - ALREADY_EXISTS
                          - PERMISSION_DENIED
                          - UNAUTHENTICATED
                          - RESOURCE_EXHAUSTED
                          - FAILED_PRECONDITION
                          - ABORTED
                          - OUT_OF_RANGE
                          - UNIMPLEMENTED
                          - INTERNAL
                          - UNAVAILABLE
                          - DATA_LOSS
                          - FORBIDDEN
                          - UNPROCESSABLE_ENTITY
                      message:
                        example: >-
                          Index name must contain only lowercase alphanumeric
                          characters or hyphens, and must not begin or end with
                          a hyphen.
                        type: string
                      details:
                        description: >-
                          Additional information about the error. This field is
                          not guaranteed to be present.
                        type: object
                    required:
                      - code
                      - message
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: &ref_2
              - status
              - error
            example: &ref_3
              error:
                code: QUOTA_EXCEEDED
                message: >-
                  The index exceeds the project quota of 5 pods by 2 pods.
                  Upgrade your account or change the project settings to
                  increase the quota.
              status: 429
        examples:
          unauthorized:
            summary: Unauthorized
            value:
              error:
                code: UNAUTHENTICATED
                message: Invalid API key.
              status: 401
        description: 'Unauthorized. Possible causes: Invalid API key.'
    '500':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - *ref_0
              error:
                allOf:
                  - *ref_1
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: *ref_2
            example: *ref_3
        examples:
          internal-server-error:
            summary: Internal server error
            value:
              error:
                code: UNKNOWN
                message: Internal server error
              status: 500
        description: Internal server error.
  deprecated: false
  type: path
components:
  schemas:
    DeletionProtection:
      description: >
        Whether [deletion
        protection](http://docs.pinecone.io/guides/manage-data/manage-indexes#configure-deletion-protection)
        is enabled/disabled for the index.
      default: disabled
      type: string
      enum:
        - disabled
        - enabled
    ServerlessSpec:
      description: Configuration needed to deploy a serverless index.
      type: object
      properties:
        cloud:
          example: aws
          description: The public cloud where you would like your index hosted.
          type: string
          enum:
            - gcp
            - aws
            - azure
        region:
          example: us-east-1
          description: 'The region where you would like your index to be created. '
          type: string
      required:
        - cloud
        - region
    PodSpec:
      example:
        environment: us-east1-gcp
        metadata_config:
          indexed:
            - genre
            - title
            - imdb_rating
        pod_type: p1.x1
        pods: 1
        replicas: 1
        shards: 1
        source_collection: movie-embeddings
      description: Configuration needed to deploy a pod-based index.
      type: object
      properties:
        environment:
          example: us-east1-gcp
          description: The environment where the index is hosted.
          type: string
        replicas:
          description: >-
            The number of replicas. Replicas duplicate your index. They provide
            higher availability and throughput. Replicas can be scaled up or
            down as your needs change.
          default: 1
          type: integer
          format: int32
          minimum: 1
        shards:
          description: >-
            The number of shards. Shards split your data across multiple pods so
            you can fit more data into an index.
          default: 1
          type: integer
          format: int32
          minimum: 1
        pod_type:
          description: >-
            The type of pod to use. One of `s1`, `p1`, or `p2` appended with `.`
            and one of `x1`, `x2`, `x4`, or `x8`.
          default: p1.x1
          type: string
        pods:
          example: 1
          description: >-
            The number of pods to be used in the index. This should be equal to
            `shards` x `replicas`.'
          default: 1
          type: integer
          minimum: 1
        metadata_config:
          example:
            indexed:
              - genre
              - title
              - imdb_rating
          description: >-
            Configuration for the behavior of Pinecone's internal metadata
            index. By default, all metadata is indexed; when `metadata_config`
            is present, only specified metadata fields are indexed. These
            configurations are only valid for use with pod-based indexes.
          type: object
          properties:
            indexed:
              description: >-
                By default, all metadata is indexed; to change this behavior,
                use this property to specify an array of metadata fields that
                should be indexed.
              type: array
              items:
                type: string
        source_collection:
          example: movie-embeddings
          description: The name of the collection to be used as the source for the index.
          type: string
      required:
        - environment
        - pod_type
    IndexModel:
      description: >-
        The IndexModel describes the configuration and status of a Pinecone
        index.
      type: object
      properties:
        name:
          example: example-index
          description: >
            The name of the index. Resource name must be 1-45 characters long,
            start and end with an alphanumeric character, and consist only of
            lower case alphanumeric characters or '-'.
          type: string
          minLength: 1
          maxLength: 45
        dimension:
          example: 1536
          description: The dimensions of the vectors to be inserted in the index.
          type: integer
          format: int32
          minimum: 1
          maximum: 20000
        metric:
          description: >-
            The distance metric to be used for similarity search. You can use
            'euclidean', 'cosine', or 'dotproduct'.
          default: cosine
          type: string
          enum:
            - cosine
            - euclidean
            - dotproduct
        host:
          example: semantic-search-c01b5b5.svc.us-west1-gcp.pinecone.io
          description: The URL address where the index is hosted.
          type: string
        deletion_protection:
          $ref: '#/components/schemas/DeletionProtection'
        spec:
          example:
            pod:
              environment: us-east-1-aws
              metadata_config:
                indexed:
                  - genre
                  - title
                  - imdb_rating
              pod_type: p1.x1
              pods: 1
              replicas: 1
              shards: 1
          type: object
          properties:
            pod:
              $ref: '#/components/schemas/PodSpec'
            serverless:
              $ref: '#/components/schemas/ServerlessSpec'
        status:
          example:
            ready: true
            state: ScalingUpPodSize
          type: object
          properties:
            ready:
              type: boolean
            state:
              type: string
              enum:
                - Initializing
                - InitializationFailed
                - ScalingUp
                - ScalingDown
                - ScalingUpPodSize
                - ScalingDownPodSize
                - Terminating
                - Ready
          required:
            - ready
            - state
      required:
        - name
        - dimension
        - metric
        - status
        - spec
        - host

````

// npm install @pinecone-database/pinecone
import { Pinecone } from '@pinecone-database/pinecone'

const pc = new Pinecone({ apiKey: 'YOUR_API_KEY' })

await pc.listIndexes();


# Create an index

> Create an index for vectors created with an external embedding model.
  
For guidance and examples, see [Create an index](https://docs.pinecone.io/guides/index-data/create-an-index).


## OpenAPI

````yaml https://raw.githubusercontent.com/pinecone-io/pinecone-api/refs/heads/main/2024-07/control_2024-07.oas.yaml post /indexes
paths:
  path: /indexes
  method: post
  servers:
    - url: https://api.pinecone.io
      description: Production API endpoints
  request:
    security:
      - title: ApiKeyAuth
        parameters:
          query: {}
          header:
            Api-Key:
              type: apiKey
              description: >-
                An API Key is required to call Pinecone APIs. Get yours from the
                [console](https://app.pinecone.io/).
          cookie: {}
    parameters:
      path: {}
      query: {}
      header: {}
      cookie: {}
    body:
      application/json:
        schemaArray:
          - type: object
            properties:
              name:
                allOf:
                  - example: example-index
                    description: >
                      The name of the index. Resource name must be 1-45
                      characters long, start and end with an alphanumeric
                      character, and consist only of lower case alphanumeric
                      characters or '-'.
                    type: string
                    minLength: 1
                    maxLength: 45
              dimension:
                allOf:
                  - example: 1536
                    description: The dimensions of the vectors to be inserted in the index.
                    type: integer
                    format: int32
                    minimum: 1
                    maximum: 20000
              metric:
                allOf:
                  - description: >-
                      The distance metric to be used for similarity search. You
                      can use 'euclidean', 'cosine', or 'dotproduct'.
                    default: cosine
                    type: string
                    enum:
                      - cosine
                      - euclidean
                      - dotproduct
              deletion_protection:
                allOf:
                  - $ref: '#/components/schemas/DeletionProtection'
              spec:
                allOf:
                  - $ref: '#/components/schemas/IndexSpec'
            required: true
            description: The configuration needed to create a Pinecone index.
            refIdentifier: '#/components/schemas/CreateIndexRequest'
            requiredProperties:
              - name
              - dimension
              - spec
        examples:
          serverless-index:
            summary: Creating a serverless index
            value:
              deletion_protection: enabled
              dimension: 1536
              metric: cosine
              name: movie-recommendations
              spec:
                serverless:
                  cloud: gcp
                  region: us-east1
          pod-index:
            summary: Creating a pod-based index
            value:
              deletion_protection: enabled
              dimension: 1536
              metric: cosine
              name: movie-recommendations
              spec:
                pod:
                  environment: us-east-1-aws
                  metadata_config:
                    indexed:
                      - genre
                      - title
                      - imdb_rating
                  pod_type: p1.x1
                  pods: 1
                  replicas: 1
                  shards: 1
                  source_collection: movie-embeddings
        description: The desired configuration for the index.
  response:
    '201':
      application/json:
        schemaArray:
          - type: object
            properties:
              name:
                allOf:
                  - example: example-index
                    description: >
                      The name of the index. Resource name must be 1-45
                      characters long, start and end with an alphanumeric
                      character, and consist only of lower case alphanumeric
                      characters or '-'.
                    type: string
                    minLength: 1
                    maxLength: 45
              dimension:
                allOf:
                  - example: 1536
                    description: The dimensions of the vectors to be inserted in the index.
                    type: integer
                    format: int32
                    minimum: 1
                    maximum: 20000
              metric:
                allOf:
                  - description: >-
                      The distance metric to be used for similarity search. You
                      can use 'euclidean', 'cosine', or 'dotproduct'.
                    default: cosine
                    type: string
                    enum:
                      - cosine
                      - euclidean
                      - dotproduct
              host:
                allOf:
                  - example: semantic-search-c01b5b5.svc.us-west1-gcp.pinecone.io
                    description: The URL address where the index is hosted.
                    type: string
              deletion_protection:
                allOf:
                  - $ref: '#/components/schemas/DeletionProtection'
              spec:
                allOf:
                  - example:
                      pod:
                        environment: us-east-1-aws
                        metadata_config:
                          indexed:
                            - genre
                            - title
                            - imdb_rating
                        pod_type: p1.x1
                        pods: 1
                        replicas: 1
                        shards: 1
                    type: object
                    properties:
                      pod:
                        $ref: '#/components/schemas/PodSpec'
                      serverless:
                        $ref: '#/components/schemas/ServerlessSpec'
              status:
                allOf:
                  - example:
                      ready: true
                      state: ScalingUpPodSize
                    type: object
                    properties:
                      ready:
                        type: boolean
                      state:
                        type: string
                        enum:
                          - Initializing
                          - InitializationFailed
                          - ScalingUp
                          - ScalingDown
                          - ScalingUpPodSize
                          - ScalingDownPodSize
                          - Terminating
                          - Ready
                    required:
                      - ready
                      - state
            description: >-
              The IndexModel describes the configuration and status of a
              Pinecone index.
            refIdentifier: '#/components/schemas/IndexModel'
            requiredProperties:
              - name
              - dimension
              - metric
              - status
              - spec
              - host
        examples:
          example:
            value:
              name: example-index
              dimension: 1536
              metric: cosine
              host: semantic-search-c01b5b5.svc.us-west1-gcp.pinecone.io
              deletion_protection: disabled
              spec:
                pod:
                  environment: us-east-1-aws
                  metadata_config:
                    indexed:
                      - genre
                      - title
                      - imdb_rating
                  pod_type: p1.x1
                  pods: 1
                  replicas: 1
                  shards: 1
              status:
                ready: true
                state: ScalingUpPodSize
        description: The index has been successfully created.
    '400':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - &ref_0
                    example: 500
                    description: The HTTP status code of the error.
                    type: integer
              error:
                allOf:
                  - &ref_1
                    example:
                      code: INVALID_ARGUMENT
                      message: >-
                        Index name must contain only lowercase alphanumeric
                        characters or hyphens, and must not begin or end with a
                        hyphen.
                    description: Detailed information about the error that occurred.
                    type: object
                    properties:
                      code:
                        type: string
                        enum:
                          - OK
                          - UNKNOWN
                          - INVALID_ARGUMENT
                          - DEADLINE_EXCEEDED
                          - QUOTA_EXCEEDED
                          - NOT_FOUND
                          - ALREADY_EXISTS
                          - PERMISSION_DENIED
                          - UNAUTHENTICATED
                          - RESOURCE_EXHAUSTED
                          - FAILED_PRECONDITION
                          - ABORTED
                          - OUT_OF_RANGE
                          - UNIMPLEMENTED
                          - INTERNAL
                          - UNAVAILABLE
                          - DATA_LOSS
                          - FORBIDDEN
                          - UNPROCESSABLE_ENTITY
                      message:
                        example: >-
                          Index name must contain only lowercase alphanumeric
                          characters or hyphens, and must not begin or end with
                          a hyphen.
                        type: string
                      details:
                        description: >-
                          Additional information about the error. This field is
                          not guaranteed to be present.
                        type: object
                    required:
                      - code
                      - message
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: &ref_2
              - status
              - error
            example: &ref_3
              error:
                code: QUOTA_EXCEEDED
                message: >-
                  The index exceeds the project quota of 5 pods by 2 pods.
                  Upgrade your account or change the project settings to
                  increase the quota.
              status: 429
        examples:
          index-metric-validation-error:
            summary: Validation error on metric.
            value:
              error:
                code: INVALID_ARGUMENT
                message: Metric must be cosine, euclidean, or dotproduct.
              status: 400
        description: Bad request. The request body included invalid request parameters.
    '401':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - *ref_0
              error:
                allOf:
                  - *ref_1
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: *ref_2
            example: *ref_3
        examples:
          unauthorized:
            summary: Unauthorized
            value:
              error:
                code: UNAUTHENTICATED
                message: Invalid API key.
              status: 401
        description: 'Unauthorized. Possible causes: Invalid API key.'
    '403':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - *ref_0
              error:
                allOf:
                  - *ref_1
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: *ref_2
            example: *ref_3
        examples:
          unauthorized:
            summary: Forbidden
            value:
              error:
                code: FORBIDDEN
                message: Increase your quota or upgrade to create more indexes.
              status: 403
        description: You've exceed your pod quota.
    '404':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - *ref_0
              error:
                allOf:
                  - *ref_1
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: *ref_2
            example: *ref_3
        examples:
          serverless-spec-cloud-not-found:
            summary: Cannot create serverless index with invalid spec.
            value:
              error:
                code: NOT_FOUND
                message: 'Resource cloud: aws region: us-west1 not found.'
              status: 404
        description: Unknown cloud or region when creating a serverless index.
    '409':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - *ref_0
              error:
                allOf:
                  - *ref_1
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: *ref_2
            example: *ref_3
        examples:
          index-name-already-exists:
            summary: Index name needs to be unique.
            value:
              error:
                code: ALREADY_EXISTS
                message: Resource already exists.
              status: 409
        description: Index of given name already exists.
    '422':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - *ref_0
              error:
                allOf:
                  - *ref_1
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: *ref_2
            example: *ref_3
        examples:
          missing-field:
            summary: Unprocessable entity
            value:
              error:
                code: UNPROCESSABLE_ENTITY
                message: >-
                  Failed to deserialize the JSON body into the target type:
                  missing field `metric` at line 1 column 16
              status: 422
        description: Unprocessable entity. The request body could not be deserialized.
    '500':
      application/json:
        schemaArray:
          - type: object
            properties:
              status:
                allOf:
                  - *ref_0
              error:
                allOf:
                  - *ref_1
            description: The response shape used for all error responses.
            refIdentifier: '#/components/schemas/ErrorResponse'
            requiredProperties: *ref_2
            example: *ref_3
        examples:
          internal-server-error:
            summary: Internal server error
            value:
              error:
                code: UNKNOWN
                message: Internal server error
              status: 500
        description: Internal server error.
  deprecated: false
  type: path
components:
  schemas:
    DeletionProtection:
      description: >
        Whether [deletion
        protection](http://docs.pinecone.io/guides/manage-data/manage-indexes#configure-deletion-protection)
        is enabled/disabled for the index.
      default: disabled
      type: string
      enum:
        - disabled
        - enabled
    IndexSpec:
      description: >
        The spec object defines how the index should be deployed.


        For serverless indexes, you define only the [cloud and
        region](http://docs.pinecone.io/guides/index-data/create-an-index#cloud-regions)
        where the index should be hosted. For pod-based indexes, you define the
        [environment](http://docs.pinecone.io/guides/indexes/pods/understanding-pod-based-indexes#pod-environments)
        where the index should be hosted, the [pod type and
        size](http://docs.pinecone.io/guides/indexes/pods/understanding-pod-based-indexes#pod-types)
        to use, and other index characteristics.
      type: object
      properties:
        serverless:
          $ref: '#/components/schemas/ServerlessSpec'
        pod:
          $ref: '#/components/schemas/PodSpec'
      additionalProperties: false
      oneOf:
        - required:
            - serverless
        - required:
            - pod
    ServerlessSpec:
      description: Configuration needed to deploy a serverless index.
      type: object
      properties:
        cloud:
          example: aws
          description: The public cloud where you would like your index hosted.
          type: string
          enum:
            - gcp
            - aws
            - azure
        region:
          example: us-east-1
          description: 'The region where you would like your index to be created. '
          type: string
      required:
        - cloud
        - region
    PodSpec:
      example:
        environment: us-east1-gcp
        metadata_config:
          indexed:
            - genre
            - title
            - imdb_rating
        pod_type: p1.x1
        pods: 1
        replicas: 1
        shards: 1
        source_collection: movie-embeddings
      description: Configuration needed to deploy a pod-based index.
      type: object
      properties:
        environment:
          example: us-east1-gcp
          description: The environment where the index is hosted.
          type: string
        replicas:
          description: >-
            The number of replicas. Replicas duplicate your index. They provide
            higher availability and throughput. Replicas can be scaled up or
            down as your needs change.
          default: 1
          type: integer
          format: int32
          minimum: 1
        shards:
          description: >-
            The number of shards. Shards split your data across multiple pods so
            you can fit more data into an index.
          default: 1
          type: integer
          format: int32
          minimum: 1
        pod_type:
          description: >-
            The type of pod to use. One of `s1`, `p1`, or `p2` appended with `.`
            and one of `x1`, `x2`, `x4`, or `x8`.
          default: p1.x1
          type: string
        pods:
          example: 1
          description: >-
            The number of pods to be used in the index. This should be equal to
            `shards` x `replicas`.'
          default: 1
          type: integer
          minimum: 1
        metadata_config:
          example:
            indexed:
              - genre
              - title
              - imdb_rating
          description: >-
            Configuration for the behavior of Pinecone's internal metadata
            index. By default, all metadata is indexed; when `metadata_config`
            is present, only specified metadata fields are indexed. These
            configurations are only valid for use with pod-based indexes.
          type: object
          properties:
            indexed:
              description: >-
                By default, all metadata is indexed; to change this behavior,
                use this property to specify an array of metadata fields that
                should be indexed.
              type: array
              items:
                type: string
        source_collection:
          example: movie-embeddings
          description: The name of the collection to be used as the source for the index.
          type: string
      required:
        - environment
        - pod_type

````

// npm install @pinecone-database/pinecone
// Serverles index
import { Pinecone } from '@pinecone-database/pinecone'

const pc = new Pinecone({
  apiKey: 'YOUR_API_KEY'
});

await pc.createIndex({
  name: 'serverless-index',
  dimension: 1536,
  metric: 'cosine',
  spec: {
    serverless: {
      cloud: 'aws',
      region: 'us-east-1'
    }
  },
  deletionProtection: 'disabled',
});

// Pod-based index
await pc.createIndex({
  name: 'docs-example2',
  dimension: 1536,
  metric: 'cosine',
  spec: {
    pod: {
      environment: 'us-west1-gcp',
      podType: 'p1.x1',
      pods: 1
    }
  },
  deletionProtection: 'disabled',
});