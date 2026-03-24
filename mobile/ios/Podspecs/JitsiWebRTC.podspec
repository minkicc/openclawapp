Pod::Spec.new do |s|
  webrtc_url = ENV['OPENCLAW_IOS_WEBRTC_URL']
  if webrtc_url.nil? || webrtc_url.empty?
    webrtc_url = 'https://github.com/jitsi/webrtc/releases/download/v124.0.2/WebRTC.xcframework.zip'
  end

  s.name = 'JitsiWebRTC'
  s.version = '124.0.2'
  s.summary = 'WebRTC build provided by Jitsi'
  s.description = 'This is the WebRTC build the Jitsi project uses and provides for React Native WebRTC'
  s.homepage = 'https://github.com/jitsi/webrtc'
  s.license = { :type => 'BSD' }
  s.authors = 'The WebRTC project authors'
  s.source = { :http => webrtc_url, :flatten => false }
  s.platforms = {
    :ios => '12.0',
    :osx => '13.0'
  }
  s.vendored_frameworks = 'WebRTC.xcframework'
end
