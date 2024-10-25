# BTC Scribe

A [simple web app](https://btcscribe.org) to store arbitrary text forever on Bitcoin, using the [taproot inscriptions protocol](https://docs.ordinals.com/inscriptions.html).

## How It Works
BTC Scribe runs purely client-side through the [mempool.space](https://mempool.space) API.

1) User enters message (i.e. "Hello World!)
2) BTC Scribe generates a taproot address ("bc1...ax7") and estimates the required fee (i.e. 1000 sats)
3) User submits payment to the generated taproot address (i.e. 1000 sats to "bc1...ax7")
4) BTC Scribe listens for payment to appear in mempool and submits reveal transaction using taproot output as the sole input

**Please note that BTC Scribe does _not_ confer ownership of the inscribed message.** BTC Scribe merely stores the message onchain. Each reveal transaction consists of a single `OP_RETURN` output to minimize fees.

## Screenshot

<img width="1450" alt="Screenshot 2024-10-25 at 11 22 15 AM" src="https://github.com/user-attachments/assets/5a4a7662-c35d-4aa2-9658-c5642949b1ac">


## Available Scripts

In the project directory, you can run:

### `yarn start`

Runs the app in the development mode.<br />
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `yarn test`

Launches the test runner in the interactive watch mode.<br />

### `yarn build`

Builds the app for production to the `build` folder.<br />
It correctly bundles React in production mode and optimizes the build for the best performance.
