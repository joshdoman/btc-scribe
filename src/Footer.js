import React from 'react';
import { Box, Text, Link, Flex, Image } from '@chakra-ui/react';

const Footer = () => {
  return (
    <Box
      as="footer"
      position="absolute"
      bottom="0"
      width="100%"
      height="60px"
      py={4}
    >
      <Flex justify="center" align="center">
        <Link href="https://github.com/joshdoman/btc-scribe" isExternal>
          <Image src="./github-mark.svg" width="22px" marginRight="6px"/>
        </Link>
        <Text mr={2}>Released under MIT License</Text>
      </Flex>
    </Box>
  );
};

export default Footer;