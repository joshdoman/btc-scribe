/* global BigInt */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ChakraProvider,
  Center,
  theme,
  Button,
  Box,
  Wrap,
  Link,
  Image,
  IconButton,
  InputGroup,
  Input,
  InputRightElement,
  Radio,
  RadioGroup,
  FormControl,
  FormHelperText,
  Text,
  VStack,
  Card,
  CardHeader,
  CardBody,
  Heading,
  Spinner,
  Flex,
  WrapItem,
  useToast,
} from "@chakra-ui/react";
import { CopyIcon } from '@chakra-ui/icons';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { useDebounce } from "@uidotdev/usehooks";
import * as btc from '@scure/btc-signer';
import * as ordinals from 'micro-ordinals';
import { hex, utf8 } from '@scure/base';
import { generateOnRampURL } from "@coinbase/cbpay-js";

// Components
import { Logo } from './Logo';
import Footer from './Footer';

// Network type
const isMainnet = true;
const NETWORK = isMainnet ? btc.NETWORK : btc.TEST_NETWORK;
const mempoolUrl = isMainnet ? 'mempool.space' : 'mempool.space/testnet';
const ordinalsUrl = isMainnet ? 'ordinals.com' : 'testnet.ordinals.com';

// Transaction params
const privKey = hex.decode('0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a'); // dummy
const pubKey = btc.utils.pubSchnorr(privKey);
const customScripts = [ordinals.OutOrdinalReveal];
const returnScript = btc.Script.encode(['RETURN', 0, 0, 0, 0]); // min-tx-size: 65 bytes

// URL params
const urlParams = new URLSearchParams(window.location.search);
const savedMsg = localStorage.getItem('lastMsg');
const defaultMsg = urlParams.get('msg') ?? (
  urlParams.get('refresh') && savedMsg ? savedMsg : ''
);

const isMobile = () => {
  return window.innerWidth < 768;
};

function App() {
  const [feeRateType, setFeeRateType] = useState('2');
  const [customFeeRate, setCustomFeeRate] = useState(1);
  const [showFeeRates, setShowFeeRates] = useState(!isMobile());
  const [conversions, setConversions] = useState(undefined);
  const [inputData, setInputData] = useState(defaultMsg);
  const [revealTx, setRevealTx] = useState(null);
  const [fees, setFees] = useState({
    economyFee: 1,
    hourFee: 1,
    halfHourFee: 1,
    fastestFee: 1,
  });
  const {
    sendJsonMessage,
    lastJsonMessage,
    readyState
  } = useWebSocket(`wss://${mempoolUrl}/api/v1/ws`);
  const debouncedTextInput = useDebounce(inputData, 600);

  // Reload current message upon refresh
  useEffect(() => {
    if (debouncedTextInput.length > 0) {
      window.history.replaceState(null, "", `?refresh=true`);
      localStorage.setItem('lastMsg', debouncedTextInput);
    }
  }, [debouncedTextInput]);

  var feeRate = 1;
  switch (feeRateType) {
    case '1':
      feeRate = fees.hourFee;
      break;
    case '2':
      feeRate = fees.halfHourFee;
      break;
    case '3':
      feeRate = fees.fastestFee;
      break;
    default:
      feeRate = customFeeRate;
  }

  const inscription = {
    tags: { contentType: 'text/plain' },
    body: utf8.decode(debouncedTextInput),
  };

  const revealPayment = btc.p2tr(
    undefined, // internalPubKey
    ordinals.p2tr_ord_reveal(pubKey, [inscription]), // TaprootScriptTree
    NETWORK, // mainnet or testnet
    false, // allowUnknownOutputs, safety feature
    customScripts // how to handle custom scripts
  );
  const revealAddress = revealPayment.address;

  // Submit reveal tx once we know commit txid and vout
  const submitRevealTx = useCallback((revealPayment, txid, index, value) => {
    if (!value) return;
    const revealTx = new btc.Transaction({ allowUnknownOutputs: true, customScripts });
    revealTx.addInput({
      ...revealPayment,
      txid,
      index,
      witnessUtxo: { script: revealPayment.script, amount: BigInt(value) },
    });
    revealTx.addOutput({ script: returnScript, amount: 0n })
    revealTx.sign(privKey, undefined, new Uint8Array(32));
    revealTx.finalize();

    fetch(
      `https://${mempoolUrl}/api/tx`, { method: 'POST', body: revealTx.hex }
    ).then(() => {
      setRevealTx(revealTx.id);
    })
  }, []);

  // Track the current address in mempool.space
  useEffect(() => {
    if (readyState !== ReadyState.OPEN) return;
    sendJsonMessage({ action: 'init' });
    sendJsonMessage({ action: 'want', data: ['stats'] });
  }, [readyState, sendJsonMessage]);

  // Submit reveal tx if utxo for reveal address exists
  useEffect(() => {
    if (debouncedTextInput === '' || revealPayment.address === undefined) return;
    fetch(`https://${mempoolUrl}/api/address/${revealPayment.address}/utxo`).then(async (res) => {
      let utxos = await res.json();
      utxos.forEach(utxo => {
        submitRevealTx(revealPayment, utxo.txid, utxo.vout, utxo.value);
      });
    }).catch((error) => {
      console.log("Fetch address utxos error:", error);
    });
  }, [debouncedTextInput, revealPayment, submitRevealTx]);

  // Create webhook to track reveal address and stop tracking any old reveal addresses
  useEffect(() => {
    if (revealAddress === undefined || readyState !== ReadyState.OPEN) return;
    sendJsonMessage({ 'track-address': 'stop' });
    if (revealAddress !== undefined) {
      sendJsonMessage({ 'track-address': revealAddress });
    }
  }, [readyState, sendJsonMessage, revealAddress]);

  // Submit reveal tx when payment is submitted to reveal address
  useEffect(() => {
    if (!lastJsonMessage) return;
    if (lastJsonMessage.conversions) {
      setConversions(lastJsonMessage.conversions);
    }
    if (lastJsonMessage.fees) {
      setFees(lastJsonMessage.fees);
    }
    if (!revealPayment.address || revealTx !== null) return;
    var transactions = [];
    if (lastJsonMessage['address-transactions']) {
      transactions.push(...lastJsonMessage['address-transactions']);
    }
    if (lastJsonMessage['block-transactions']) {
      transactions.push(...lastJsonMessage['block-transactions']);
    }

    if (transactions.length > 0) {
      let commitTx = transactions[0];
      for (const [i, vout] of commitTx["vout"].entries()) {
        if (vout['scriptpubkey_address'] === revealPayment.address) {          
          submitRevealTx(revealPayment, commitTx.txid, i, BigInt(vout['value']));
          break;
        }
      }
    }
  }, [lastJsonMessage, revealPayment, revealTx, submitRevealTx]);

  // Calculate recommended fee given fee rate
  const commitTx = new btc.Transaction({ allowUnknownOutputs: true, customScripts });
  commitTx.addInput({
    ...revealPayment,
    txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b', // placeholder until we know commit txid
    index: 0,
    witnessUtxo: { script: revealPayment.script, amount: 0n },
  });
  commitTx.addOutput({ script: returnScript, amount: 0n })
  commitTx.sign(privKey, undefined, new Uint8Array(32));
  commitTx.finalize();
  const fee = Math.max(330, commitTx.vsize * feeRate);
  const feeUSD = conversions && (fee * conversions['USD'] / 100_000_000).toFixed(2);
  const feeUSDText = feeUSD ? `($${feeUSD})` : '';

  const toast = useToast();
  const handleCopy = () => {
    navigator.clipboard.writeText(revealPayment.address).then(() => {
      toast({
        title: "Copied!",
        description: `The address has been copied to your clipboard.`,
        status: "success",
        duration: 3000,
        isClosable: true,
      });
    }).catch(() => {
      toast({
        title: "Error",
        description: "Failed to copy the address.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    });
  };

  const onRampURL = generateOnRampURL({
    appId: "1f0b37b2-582d-461b-8fb4-0b995e15d8f7",
    addresses: {
      [revealAddress]: ["bitcoin"],
    },
    assets: ["BTC"],
    presetCryptoAmount: Math.max(fee / 100_000_000, 0.0001),
    defaultExperience: "send",
  });

  return (
    <ChakraProvider theme={theme}>
      <Center minH="100vh" bg="gray.50" display="flex" flexDirection="column" paddingBottom="60px">
        <Card minW="80%">
          <CardHeader>
            <Heading size="md">
              <Flex align="center" justify="flex-start">
                <Logo
                  width="8"
                  cursor="pointer"
                  onClick={() => {
                    window.location.href = "/";
                  }} />
                <Text marginLeft="2" marginTop="2" fontSize="2xl" textAlign="left">Welcome to BTC Scribe!</Text>
              </Flex>
            </Heading>
            <Text marginTop={4}>
              The simplest way to store a message <Text as="span" fontWeight="bold">forever</Text> on Bitcoin.
            </Text>
          </CardHeader>
          <CardBody>
            <VStack spacing={4} align="stretch">
              <Box>
                <Text mb={2}>Write Message</Text>
                <Input
                  placeholder="Type message here..."
                  value={inputData}
                  onChange={(e) => setInputData(e.target.value)}
                />
              </Box>

              {
                (debouncedTextInput !== '') && (
                  <>
                    <Box>
                      <Flex align="center" justify="space-between" p={4} padding={0}>
                        <Text >Fee Rate: {feeRate} sats/vB</Text>
                        <Image
                          width="24px"
                          src="./settings.svg"
                          marginRight={2}
                          cursor="pointer"
                          hidden={!isMobile()}
                          onClick={() => {
                            setShowFeeRates(!showFeeRates);
                          }} />
                      </Flex>
                      
                      {
                        (showFeeRates) && (
                          <RadioGroup onChange={setFeeRateType} value={feeRateType}>
                            <Wrap spacing={4} justify="center">
                              <WrapItem>
                                <Radio 
                                  value="1" 
                                  borderColor="gray.300" 
                                  colorScheme="teal"
                                  borderWidth="2px" 
                                  borderRadius="md" 
                                  px={6} 
                                  py={4}
                                  _hover={{ bg: "teal.100" }}
                                >
                                  Slow ({fees.hourFee} sats/vB)
                                </Radio>
                              </WrapItem>
                              <WrapItem>
                                <Radio 
                                  value="2" 
                                  borderColor="gray.300" 
                                  colorScheme="teal"
                                  borderWidth="2px" 
                                  borderRadius="md" 
                                  px={6} 
                                  py={4}
                                  _hover={{ bg: "teal.100" }}
                                >
                                  Normal ({fees.halfHourFee} sats/vB)
                                </Radio>
                              </WrapItem>
                              <WrapItem>
                                <Radio 
                                  value="3" 
                                  borderColor="gray.300" 
                                  colorScheme="teal"
                                  borderWidth="2px" 
                                  borderRadius="md" 
                                  px={6} 
                                  py={4}
                                  _hover={{ bg: "teal.100" }}
                                >
                                  Fast ({fees.fastestFee} sats/vB)
                                </Radio>
                              </WrapItem>
                              <WrapItem>
                                <Radio 
                                  value="4" 
                                  borderColor="gray.300" 
                                  colorScheme="teal"
                                  borderWidth="2px" 
                                  borderRadius="md" 
                                  px={6} 
                                  py={4}
                                  _hover={{ bg: "teal.100" }}
                                >
                                  Custom
                                </Radio>
                                <Input
                                  value={customFeeRate}
                                  onChange={(e) => setCustomFeeRate(e.target.value)}
                                  type="number"
                                  min={1}
                                  max={1000}
                                  fontSize={14}
                                  paddingLeft={2}
                                  height={8}
                                  position="relative"
                                  top="50%"
                                  transform="translateY(-50%)"
                                  />
                              </WrapItem>
                            </Wrap>
                          </RadioGroup>
                        )
                      }
                    </Box>
                    
                    <Box>
                      <Text mb={2}>Fee</Text>
                      
                      <FormControl>
                        <Input
                          value={`${fee} sats`}
                          isReadOnly
                        />
                        <FormHelperText fontStyle="italic" fontSize="12" minH="14px">
                          {feeUSDText}
                        </FormHelperText>
                      </FormControl>
                    </Box>

                    <Box>
                      <Text mb={2}>Pay To</Text>
                      <InputGroup>
                        <Input
                          value={revealPayment.address}
                          isReadOnly
                          fontFamily="mono"
                          fontSize="sm"
                          />
                        <InputRightElement>
                          <IconButton
                            aria-label="Copy text"
                            icon={<CopyIcon />}
                            onClick={handleCopy}
                            size="sm"
                            h="100%"
                            w="100%"
                            />
                        </InputRightElement>
                      </InputGroup>
                    </Box>
                    
                    {
                      (revealTx === null) ? (
                        <Box>
                          <Flex align="center">
                            <Spinner size="sm" mr={2} /> {/* Spinner with right margin */}
                            {
                              (inputData === '' || inputData === debouncedTextInput) ? (
                                <Text>Scanning for payment...</Text>
                              ) : (
                                <Text>Waiting for user to finish typing...</Text>
                              )
                            }
                          </Flex>
                          <Text fontStyle="italic" marginTop="4" fontSize="12">
                            {`Can't pay with BTC? `}
                            <Link color="teal" onClick={() => {
                              window.open(onRampURL, '_blank', 'noopener,noreferrer,width=600,height=800');
                            }}>
                              Pay with card
                            </Link> instead.
                          </Text>
                        </Box>
                      ) : (
                        <Box>
                          <Text fontWeight="bold" color="green">Payment received!</Text>
                          <Text>
                            <Link href={`https://${mempoolUrl}/tx/${revealTx}`} isExternal color="blue">
                              View reveal transaction
                            </Link>
                            {` (${revealTx})`}
                          </Text>
                          <Text>
                            <Link href={`https://${ordinalsUrl}/inscription/${revealTx}i0`} isExternal color="blue">
                              View inscription
                            </Link>
                            {` (available after 1 confirmation)`}
                          </Text>
                          <Button size="sm" padding="4" marginTop="2" onClick={() => {
                            window.location.href = "/";
                          }}>
                            Reset
                          </Button>
                        </Box>
                      )
                    }
                  </>
                )
              }
            </VStack>
          </CardBody>
        </Card>
        <Footer />
      </Center>
    </ChakraProvider>
  );
}

export default App;