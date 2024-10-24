import React from 'react';
import { Image } from '@chakra-ui/react';
import logo from './ink-feather.svg';

export const Logo = props => {
  return <Image src={logo} {...props} />;
};
