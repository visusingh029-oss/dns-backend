const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const xml2js = require('xml2js');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3001;

app.use(cors());

app.use(bodyParser.json());
app.use((req, res, next) => {
    // Sirf Method aur URL print karega (API Key nahi)
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Helper to parse XML response from Namecheap
const parseNamecheapResponse = (xml) => {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xml, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
};

app.post('/api/update-dns', async (req, res) => {
    // Log hata diya gaya hai
    const { apiUser, apiKey, domains, nameservers, clientIp } = req.body;

    if (!apiUser || !apiKey || !domains || !domains.length || !nameservers || !nameservers.length || !clientIp) {
        console.error('Missing required fields');
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Set headers for streaming response
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    const nsString = nameservers.join(',');

    for (const domain of domains) {
        if (!domain) continue;
        console.log(`Processing domain: ${domain}`);
        try {
            const parts = domain.split('.');
            if (parts.length < 2) {
                const errorMsg = `Invalid domain format: ${domain}`;
                console.log(`Error for ${domain}: ${errorMsg}`);
                res.write(JSON.stringify({ domain: domain, status: 'error', message: errorMsg }) + '\n');
                continue;
            }

            const tld = parts.pop();
            const sld = parts.join('.');

            const url = `https://api.namecheap.com/xml.response?ApiUser=${apiUser}&ApiKey=${apiKey}&UserName=${apiUser}&Command=namecheap.domains.dns.setCustom&ClientIp=${clientIp}&SLD=${sld}&TLD=${tld}&Nameservers=${nsString}`;

            console.log(`Calling Namecheap for ${domain}...`);
            const response = await axios.get(url);

            const parsed = await parseNamecheapResponse(response.data);

            if (parsed.ApiResponse && parsed.ApiResponse.$.Status === 'OK') {
                const successMsg = 'Nameservers updated successfully';
                console.log(`Success for ${domain}`);
                res.write(JSON.stringify({ domain: domain, status: 'success', message: successMsg }) + '\n');
            } else {
                let errorMsg = 'Unknown error from Namecheap';
                if (parsed.ApiResponse && parsed.ApiResponse.Errors && parsed.ApiResponse.Errors[0] && parsed.ApiResponse.Errors[0].Error) {
                    const errObj = parsed.ApiResponse.Errors[0].Error[0];
                    if (typeof errObj === 'string') {
                        errorMsg = errObj;
                    } else if (errObj && errObj._) {
                        errorMsg = errObj._;
                    } else {
                        errorMsg = JSON.stringify(errObj);
                    }
                }
                console.log(`Error for ${domain}: ${errorMsg}`);
                res.write(JSON.stringify({ domain: domain, status: 'error', message: errorMsg }) + '\n');
            }

        } catch (error) {
            const errorMsg = error.message || 'Request failed';
            console.error(`Exception for ${domain}:`, error);
            res.write(JSON.stringify({ domain: domain, status: 'error', message: errorMsg }) + '\n');
        }

        // Add a delay to avoid hitting rate limits (2 seconds)
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    res.end();
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
