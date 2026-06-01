import { Image, StyleSheet } from 'react-native';

type Props = {
  size?: 'large' | 'mini';
};

export default function AppLogo({ size = 'mini' }: Props) {
  return (
    <Image
      source={require('../../assets/logo.png')}
      style={size === 'large' ? styles.large : styles.mini}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  large: {
    width: 160,
    height: 160,
  },
  mini: {
    width: 110,
    height: 40,
  },
});
