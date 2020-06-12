const axios = require('axios');
const qs = require('querystring');
const moment = require('moment');
const fs = require('fs');
const dotenv = require('dotenv').config();

const HISTORY_URL = 'https://slack.com/api/conversations.history';

// Slack Stuff
const SLACK_TOKEN = process.env.SLACK_TOKEN;
const DRACULA_CHANNEL_ID = process.env.DRACULA_CHANNEL_ID;
const PROJ_CAMPUS_STORAGE_URL = process.env.PROJ_CAMPUS_STORAGE_WEBHOOK;
const PROXIMA_WEB_HOOK_URL = process.env.PROXIMA_WEB_HOOK;
const webhook_headers = {
    'Content-Type': 'application/json'
};

// No need to figure out timezones since this should always be ran at the end of the day. (10pm CDT)
const START = moment().startOf('day');
const END = moment().startOf('day').add(22, "hours");

let TOTAL_RAW_RECORDS = [];

// This will need to be put on a timer somehow on AWS Lambda. 
(async() => {
    
    // const minusOneDay = START.subtract(2, "days");
    console.log(`Fetching messages from ${ START.format('dddd MMM D YYYY HH MM SS')}`)
    console.log('End of day is: ', END.format('dddd MMM D YYYY HH MM SS'));

    TOTAL_RAW_RECORDS.length = 0;
    const arr = await getMessages(START.unix(), END.unix(), []);


    console.log(`* Number of Campus Moves: ${ TOTAL_RAW_RECORDS.length }`);
    let results = await parseMessagesForAttachments(TOTAL_RAW_RECORDS);
    
    const dataToSlack = {'text': `Total Count of Deals: ${results.messageCount}`};

    // Split results by school:
    results = await splitBySchool(results);

    // do something with the results
    fs.writeFileSync('output.json', JSON.stringify(results));

    const slackBlockFormat = await createSlackBlockResponse(results);
    console.log('Total Deals: ', results.deals.length);

    // Write Results to Slack Channel: 
    // axios.post(PROJ_CAMPUS_STORAGE_URL, slackBlockFormat, webhook_headers).then(response => {
    //     console.log('Success to Slack');
    // }).catch(error => {
    //     console.log('Error Writing to slack: ', error);
    // })

    // Finished =) 
})();

// Parse Messages from Slack Channel
async function parseMessagesForAttachments(arr) {
    const results = {
        messageCount: 0,
        totalPhotos: 0,
        deals: [],
        bySchool: []
    };

    const dealsArray = [];

    arr.forEach((entry, i) => {
        // console.log(entry);
        if(entry && entry.subtype && entry.subtype === 'bot_message') {
            const entryArray = entry.text.split(',');
            if((entryArray.length === 4) && (entryArray[0] === 'dracula')){
                // Then we have a message from Twilio
                // console.log(entryArray);

                // We have to make the last value a number, which represents number of photos.
                entryArray[3] = parseFloat(entryArray[3]);

                // Add to deals. 
                results.deals.push(entryArray);
            }    
        }
    });

    // Remove duplicates
    const filteredArr = results.deals.reduce((acc, current) => {
        const accDuplicate = acc.findIndex(el => el[1] === current[1]);
        if(accDuplicate !== -1) {
            // If the photo count for record already inside ACC is lower than the new duplicate
            // Then we want to keep the higher photo count. Replace it. 
            if(acc[accDuplicate][3] < current[3]) {
                acc[accDuplicate][3] = current[3];
            }
        } else {
            acc.push(current);
        }

        return acc;
    }, [])

    const unfilteredTotalPictures = results.deals.reduce((acc, current) => {
        return acc + current[3];
    }, 0);

    console.log('Total filtered: ' + filteredArr.length);
    const totalPhotoCount = filteredArr.reduce((acc, current) => {
        return acc + current[3];
    }, 0);

    console.log('Total Pictures UNFILTERED : ', unfilteredTotalPictures);
    console.log('Total Pictures filtered uploaded: ', totalPhotoCount);

    // Set the new deals list with the filtered list that removed duplicates. 
    results.deals = filteredArr;
    results.totalPhotos = totalPhotoCount;

    return results;
}

// Get messages from Slack Channel
async function getMessages(ts, ds, arr, next) {
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    };
    const body = {
        channel: DRACULA_CHANNEL_ID,
        token: SLACK_TOKEN,
        latest: ds,
        oldest: ts
    };

    if(next) {
        body.cursor = next;
    }

    const res = await axios.post(HISTORY_URL, qs.stringify(body), { headers });
    arr = arr.concat(res.data.messages);
    TOTAL_RAW_RECORDS = arr.concat(res.data.message);
    if(res.data.response_metadata && res.data.response_metadata.next_cursor !== null) {
        await getMessages(ts, ds, arr, res.data.response_metadata.next_cursor);
    }

    return arr.reverse();
}

async function splitBySchool(results) {
    const schoolNames = [];

    results.deals.forEach((deal, index) => {
        if(results.bySchool.length === 0) {        
            results.bySchool.push([deal]);
            schoolNames.push(deal[2]);
        } else {
            const schoolIndex = schoolNames.findIndex(el => el === deal[2]);
            if(schoolIndex !== -1) {
                results.bySchool[schoolIndex].push(deal);
            } else {
                // School already has a list. Just add it to the index
                schoolNames.push(deal[2]);
                results.bySchool.push([deal]);
            }
        }
    })

    console.log('Number of schools: ', results.bySchool.length);
    return results;
}

// Function to create Slack Bot response. 
async function createSlackBlockResponse(results) {
    const blockText = {
        "text": "I am going to write long text here",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `    *:male_vampire: Today's Analytics for SMS System Traffic :male_vampire:*     \n                   *For ${ START.format('dddd MMM D YYYY ')}*           `
                }
            },
            {
                "type": "section",
                "block_id": "section567",
                "text": {
                    "type": "mrkdwn",
                    "text": `Total Unique Deals Queried: ${results.deals.length}\nTotal Photo Traffic: ${results.totalPhotos}`
                }
            }
        ]
    }

    for(let x=0; x < results.bySchool.length; x++) {
        blockText.blocks.push(createSchoolBlock(results.bySchool[x], x));
    }

    return blockText;
}

function createSchoolBlock(schoolArray, schoolIndex) {
    const schoolName = schoolArray[0][2];
    const totalPics = schoolArray.reduce((acc, current) => {
        return acc + current[3];
    }, 0);

    const schoolBlock = {
        "type": "section",
        "block_id": `section789${schoolIndex}`,
        "text": {
                "type": "mrkdwn",
                "text": `*${schoolName}*\n Total Deals: ${schoolArray.length}\n Total Pictures: ${totalPics}`
        }
    }

    return schoolBlock;
}