import {oncePerServices, missingService} from '../../../common/services'

export const name = require('../../../common/services/serviceName').default(__filename);

export default oncePerServices(function (services) {

  const {
    postgres = missingService('postgres'),
  } = services;

  function DataInteraction() {}

  DataInteraction.prototype = {
    create: require('./create').default(services),
    get: require('./get').default(services),
    getChildren: require('./getChildren').default(services),
    getByMessageId: require('./getByMessageId').default(services),
    _update: require('./update').default(services),
    process: require('./process').default(services),
  };

  return new (require('../../../common/services').Service(services)(DataInteraction))(name, {dependsOn: [postgres]});
})
