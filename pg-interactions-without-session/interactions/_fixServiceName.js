import configAPI from 'config';

const nodeName = configAPI.get('node');

export default function(name) {
  return `${nodeName}/${name}`;
}
