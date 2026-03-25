Pod::Spec.new do |s|
  zxing_url = ENV['OPENCLAW_IOS_ZXING_URL']

  s.name = 'ZXingObjC'
  s.version = '3.6.8'
  s.summary = 'An Objective-C Port of the ZXing barcode framework.'
  s.homepage = 'https://github.com/zxingify/zxingify-objc'
  s.authors = 'zxingify'
  s.license = {
    :type => 'Apache License 2.0',
    :file => 'COPYING'
  }
  if zxing_url.nil? || zxing_url.empty?
    s.source = { :git => 'https://github.com/zxingify/zxingify-objc.git', :tag => s.version.to_s }
  else
    s.source = { :http => zxing_url, :type => 'tar.gz' }
  end
  s.requires_arc = true
  s.xcconfig = {
    'OTHER_LDFLAGS' => '-ObjC'
  }
  s.platforms = {
    :ios => '11.0',
    :osx => '10.15'
  }
  s.ios.frameworks = [
    'AVFoundation',
    'CoreGraphics',
    'CoreMedia',
    'CoreVideo',
    'ImageIO',
    'QuartzCore'
  ]
  s.osx.frameworks = [
    'AVFoundation',
    'CoreMedia',
    'QuartzCore'
  ]
  s.default_subspecs = 'All'

  s.subspec 'All' do |all|
    all.source_files = 'ZXingObjC/**/*.{h,m}'
  end

  s.subspec 'Core' do |core|
    core.source_files = [
      'ZXingObjC/*.{h,m}',
      'ZXingObjC/client/*.{h,m}',
      'ZXingObjC/common/**/*.{h,m}',
      'ZXingObjC/core/**/*.{h,m}',
      'ZXingObjC/multi/**/*.{h,m}'
    ]
    core.xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => 'ZXINGOBJC_USE_SUBSPECS'
    }
  end

  s.subspec 'Aztec' do |aztec|
    aztec.dependency 'ZXingObjC/Core'
    aztec.source_files = 'ZXingObjC/aztec/**/*.{h,m}'
    aztec.xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => 'ZXINGOBJC_USE_SUBSPECS ZXINGOBJC_AZTEC'
    }
  end

  s.subspec 'DataMatrix' do |data_matrix|
    data_matrix.dependency 'ZXingObjC/Core'
    data_matrix.source_files = 'ZXingObjC/datamatrix/**/*.{h,m}'
    data_matrix.xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => 'ZXINGOBJC_USE_SUBSPECS ZXINGOBJC_DATAMATRIX'
    }
  end

  s.subspec 'MaxiCode' do |maxi_code|
    maxi_code.dependency 'ZXingObjC/Core'
    maxi_code.source_files = 'ZXingObjC/maxicode/**/*.{h,m}'
    maxi_code.xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => 'ZXINGOBJC_USE_SUBSPECS ZXINGOBJC_MAXICODE'
    }
  end

  s.subspec 'OneD' do |one_d|
    one_d.dependency 'ZXingObjC/Core'
    one_d.source_files = [
      'ZXingObjC/oned/**/*.{h,m}',
      'ZXingObjC/client/result/**/*.{h,m}'
    ]
    one_d.xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => 'ZXINGOBJC_USE_SUBSPECS ZXINGOBJC_ONED'
    }
  end

  s.subspec 'PDF417' do |pdf417|
    pdf417.dependency 'ZXingObjC/Core'
    pdf417.source_files = 'ZXingObjC/pdf417/**/*.{h,m}'
    pdf417.xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => 'ZXINGOBJC_USE_SUBSPECS ZXINGOBJC_PDF417'
    }
  end

  s.subspec 'QRCode' do |qrcode|
    qrcode.dependency 'ZXingObjC/Core'
    qrcode.source_files = 'ZXingObjC/qrcode/**/*.{h,m}'
    qrcode.xcconfig = {
      'GCC_PREPROCESSOR_DEFINITIONS' => 'ZXINGOBJC_USE_SUBSPECS ZXINGOBJC_QRCODE'
    }
  end
end
