import { bootstrapCameraKit, CameraKitSession, createMediaStreamSource, Transform2D } from '@snap/camera-kit';
import './style.css';

(async function () {
  // Create loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.className = 'loading-indicator';
  loadingIndicator.innerHTML = '<div class="spinner"></div><p>Loading Camera Kit...</p>';
  document.body.appendChild(loadingIndicator);

  try {
    const cameraKit = await bootstrapCameraKit({
      apiToken: 'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzI3NzA4NjczLCJzdWIiOiJlNjVkNDM0Zi1lZjE4LTRhZmEtOGQyZS1mMmQ1MzIwMzBiYjJ-UFJPRFVDVElPTn5hNmY2M2NlZS1mZWJlLTQwYWYtODE3Ny02MTgwYjNiNjBkODAifQ.QcOReDbrnbHUB6CyX0dAUfFCYZAXd9VZ9DiZb47E6pc',
    });
    
    // Update loading message
    loadingIndicator.querySelector('p')!.textContent = 'Initializing camera...';
    
    // Create main app container
    const appContainer = document.createElement('div');
    appContainer.className = 'app-container';
    document.body.appendChild(appContainer);
    
    // Create camera container
    const cameraContainer = document.createElement('div');
    cameraContainer.className = 'camera-container';
    appContainer.appendChild(cameraContainer);
    
    // Move canvas into camera container
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    document.body.removeChild(canvas);
    cameraContainer.appendChild(canvas);
    
    // Detect device type
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    
    // Set appropriate class based on device type
    if (isMobile) {
      cameraContainer.classList.add('mobile');
    } else {
      cameraContainer.classList.add('desktop');
    }
    
    const liveRenderTarget = canvas;
    
    // Create a session with optimal rendering settings
    const session = await cameraKit.createSession({ 
      liveRenderTarget,
      renderOptions: {
        cameraFeedOption: 'cover', // Use 'contain' to prevent zoom
        preferredVideoFrameRate: 60, // Request higher frame rate
        highPerformanceRendering: true // Enable high performance mode
      }
    });
    
    // Get available video devices and define key variables
    let isBackFacing = true; // Start with back camera
    let currentMediaStream: MediaStream;
    let isMirrored = false;
    let isRecording = false;
    let mediaRecorder: MediaRecorder | null = null;
    let recordedChunks: BlobPart[] = [];
    let captureMode: 'photo' | 'video' = 'photo';
    
    // Helper function to get optimal video constraints
    async function getBestVideoConstraints() {
      // For higher FPS, we want to prioritize frame rate over resolution
      // especially for lens processing which can be CPU intensive
      
      // For Android, we'll use a balanced approach
      if (isAndroid) {
        return {
          width: { ideal: 1280 }, // HD is sufficient and better for performance
          height: { ideal: 720 },
          facingMode: isBackFacing ? 'environment' : 'user',
          frameRate: { ideal: 60, min: 30 } // Request 60fps with minimum 30fps
        };
      }
      
      // For other devices, try to balance resolution and framerate
      // Better to have smooth performance at lower resolution than choppy at high res
      return {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: isBackFacing ? 'environment' : 'user',
        frameRate: { ideal: 60, min: 30 }
      };
    }
    
    // Function to get media stream based on front/back camera preference
    async function getMediaStream() {
      try {
        // Get the best video constraints available
        const videoConstraints = await getBestVideoConstraints();
        
        const constraints = {
          video: videoConstraints,
          audio: false
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentMediaStream = stream;
        
        // Log the obtained resolution for debugging
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        console.log('Camera resolution:', settings.width, 'x', settings.height, 'at', settings.frameRate, 'fps');
        
        // Apply optimal track constraints for performance
        await videoTrack.applyConstraints({
          advanced: [
            { frameRate: { ideal: 60, min: 30 } }, // Focus on high framerate
            { width: { ideal: 1280 } },
            { height: { ideal: 720 } }
          ]
        });
        
        return stream;
      } catch (error) {
        console.error('Error accessing media devices:', error);
        // Fallback to any available camera
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ 
          video: {
            frameRate: { ideal: 30 }, // Still try to get decent framerate
            width: { ideal: 640 }, 
            height: { ideal: 480 }
          }
        });
        currentMediaStream = fallbackStream;
        return fallbackStream;
      }
    }
    
    // Function to switch between front and back cameras
    async function switchCamera() {
      loadingIndicator.style.display = 'flex';
      loadingIndicator.querySelector('p')!.textContent = 'Switching camera...';
      
      try {
        // Toggle camera direction
        isBackFacing = !isBackFacing;
        
        // Stop current tracks
        if (currentMediaStream) {
          currentMediaStream.getTracks().forEach(track => track.stop());
        }
        
        // Get new media stream with opposite camera
        const newMediaStream = await getMediaStream();
        
        // Create source with appropriate camera type
        const source = createMediaStreamSource(newMediaStream, {
          cameraType: isBackFacing ? 'environment' : 'user'
        });
        
        // Configure source for optimal performance
        source.setRenderSize(1280, 720); // Set consistent render size
        
        // Apply mirroring for front camera only
        if (!isBackFacing) {
          source.setTransform(Transform2D.MirrorX);
        }
        
        // Set the new source
        await session.setSource(source);
        
        // Reapply lens if active
        if (lensActive && lens) {
          await session.applyLens(lens);
        }
      } catch (error) {
        console.error('Error switching camera:', error);
        // Display error message to user if needed
      } finally {
        loadingIndicator.style.display = 'none';
      }
    }
    
    // Get initial media stream
    const initialStream = await getMediaStream();
    
    // Create source with appropriate camera type and optimal configuration
    const initialSource = createMediaStreamSource(initialStream, {
      cameraType: isBackFacing ? 'environment' : 'user'
    });
    
    // Configure source for optimal performance
    initialSource.setRenderSize(1280, 720); // Set consistent render size
    
    // Apply initial source to session
    await session.setSource(initialSource);
    await session.play();

    // Create UI controls - positioned inside the camera-container
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'controls';
    cameraContainer.appendChild(controlsDiv);

    // Create capture controls container
    const captureControlsDiv = document.createElement('div');
    captureControlsDiv.className = 'capture-controls';
    controlsDiv.appendChild(captureControlsDiv);

    // Create capture button (first to be centered)
    const captureButton = document.createElement('div');
    captureButton.className = 'capture-button';
    captureControlsDiv.appendChild(captureButton);

    // Create camera flip button - to the right of the capture button
    const cameraFlipButton = document.createElement('div');
    cameraFlipButton.className = 'camera-flip';
    cameraFlipButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6h6"></path><path d="m3 8 6-6"></path><path d="M21 12A9 9 0 0 0 6.16 5.73"></path><path d="M21 22v-6h-6"></path><path d="m21 16-6 6"></path><path d="M3 12a9 9 0 0 0 14.84 6.27"></path></svg>';
    captureControlsDiv.appendChild(cameraFlipButton);

    // Create mode switch - after the capture button (below)
    const modeSwitch = document.createElement('div');
    modeSwitch.className = 'mode-switch';
    
    const photoOption = document.createElement('div');
    photoOption.className = 'mode-option active';
    photoOption.textContent = 'Foto';
    
    const videoOption = document.createElement('div');
    videoOption.className = 'mode-option';
    videoOption.textContent = 'Vídeo';
    
    modeSwitch.appendChild(photoOption);
    modeSwitch.appendChild(videoOption);
    controlsDiv.appendChild(modeSwitch);

    // Create "Powered by Snapchat" section - outside the camera-container
    const poweredByDiv = document.createElement('div');
    poweredByDiv.className = 'powered-by';
    poweredByDiv.innerHTML = 'Powered by <img src="https://upload.wikimedia.org/wikipedia/en/thumb/c/c4/Snapchat_logo.svg/320px-Snapchat_logo.svg.png" alt="Snapchat" class="snapchat-logo">';
    appContainer.appendChild(poweredByDiv);

    // Create preview container
    const previewContainer = document.createElement('div');
    previewContainer.className = 'preview-container';
    document.body.appendChild(previewContainer);

    // Mode switch event listeners
    photoOption.addEventListener('click', () => {
      if (captureMode !== 'photo') {
        captureMode = 'photo';
        photoOption.classList.add('active');
        videoOption.classList.remove('active');
        captureButton.classList.remove('recording');
        
        // Stop recording if in progress
        if (isRecording) {
          stopRecording();
        }
      }
    });

    videoOption.addEventListener('click', () => {
      if (captureMode !== 'video') {
        captureMode = 'video';
        videoOption.classList.add('active');
        photoOption.classList.remove('active');
      }
    });

    // Function to capture photo
    function capturePhoto() {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      // Create a new canvas to capture the current frame
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = canvas.width;
      captureCanvas.height = canvas.height;
      const ctx = captureCanvas.getContext('2d');
      
      if (ctx) {
        // Draw the current frame to the capture canvas
        ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
        
        // Show preview
        showPreview(captureCanvas.toDataURL('image/png'), 'photo');
      }
    }

    // Function to start recording with optimizations for better performance
    function startRecording() {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      const stream = canvas.captureStream(30); // 30 FPS is sufficient for recording
      
      recordedChunks = [];
      
      // Optimized recording settings for better performance
      // Note: Using lower bitrate to reduce processing load during recording
      const options: MediaRecorderOptions = {
        mimeType: 'video/webm;codecs=vp8',  // vp8 is more widely supported and less CPU intensive
        videoBitsPerSecond: 2500000         // 2.5 Mbps for good balance of quality/performance
      };
      
      // Check available mimeTypes
      let mimeType = 'video/webm;codecs=vp8';
      
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';  // Let browser choose best format
        }
      }
      
      if (mimeType) {
        options.mimeType = mimeType;
      }
      
      console.log('Using recording format:', mimeType || 'browser default');
      
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (error) {
        console.error('Error creating MediaRecorder:', error);
        // Fallback without specific options
        mediaRecorder = new MediaRecorder(stream);
      }
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'video/webm' });
        console.log('Video recorded in format:', mediaRecorder?.mimeType || 'video/webm');
        showPreview(URL.createObjectURL(blob), 'video');
      };
      
      // Request chunks every 2 seconds for better performance
      mediaRecorder.start(2000);
      isRecording = true;
      captureButton.classList.add('recording');
    }

    // Function to stop recording
    function stopRecording() {
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        captureButton.classList.remove('recording');
      }
    }

    // Function to convert WebM to MP4 using FFmpeg.wasm
    // This is a simulated function, as complete conversion requires FFmpeg.wasm which isn't included
    async function convertToMP4(blob: Blob): Promise<Blob> {
      // For Android, which has specific issues with WebM
      if (isAndroid) {
        console.log('Converting video to MP4 (simulated for Android)');
        // In a real implementation, you would use FFmpeg.wasm here
        // As a workaround, we'll just change the MIME type
        return new Blob([blob], { type: 'video/mp4' });
      }
      
      // For other devices, try to convert if not MP4
      if (blob.type !== 'video/mp4') {
        console.log('Converting video to MP4 (simulated)');
        // In a real implementation, you would use FFmpeg.wasm here
        return new Blob([blob], { type: 'video/mp4' });
      }
      
      return blob;
    }

    // Function to share content on mobile devices
    async function shareContent(blob: Blob, fileName: string): Promise<boolean> {
      try {
        // Ensure the file is MP4 for sharing
        if (fileName.endsWith('.mp4') && blob.type !== 'video/mp4') {
          blob = await convertToMP4(blob);
        }
        
        // Check if Web Share API is supported
        if (navigator.share && navigator.canShare) {
          const file = new File([blob], fileName, { type: blob.type });
          
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: 'Compartilhar mídia',
              text: 'Confira esta mídia que capturei!'
            });
            return true;
          }
        }
        return false;
      } catch (error) {
        console.error('Error sharing content:', error);
        return false;
      }
    }

    // Function to show preview
    function showPreview(url: string, type: 'photo' | 'video') {
      // Clear previous content
      previewContainer.innerHTML = '';
      
      // Create content element based on type
      let contentElement;
      if (type === 'photo') {
        contentElement = document.createElement('img');
      } else {
        contentElement = document.createElement('video');
        contentElement.setAttribute('controls', 'true');
        contentElement.setAttribute('autoplay', 'true');
      }
      
      contentElement.className = 'preview-content';
      contentElement.src = url;
      previewContainer.appendChild(contentElement);
      
      // Create controls
      const previewControls = document.createElement('div');
      previewControls.className = 'preview-controls';
      
      // Action button (Share on mobile, Download on desktop)
      const actionButton = document.createElement('button');
      actionButton.className = 'preview-button download-button';
      actionButton.textContent = isMobile ? 'Compartilhar' : 'Download';
      
      actionButton.addEventListener('click', async () => {
        // Get the blob from URL
        if (type === 'photo') {
          // For photos, fetch the data URL and convert to blob
          const response = await fetch(url);
          const blob = await response.blob();
          const fileName = 'photo.png';
          
          if (isMobile) {
            // Try to use share API on mobile
            const shared = await shareContent(blob, fileName);
            if (!shared) {
              // Fallback to download if sharing fails
              const a = document.createElement('a');
              a.href = url;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          } else {
            // Download on desktop
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        } else {
          // For videos - ensure we use MP4
          const response = await fetch(url);
          let blob = await response.blob();
          const originalFormat = blob.type;
          
          // Always convert to MP4, especially for Android
          console.log('Original video format:', originalFormat);
          blob = await convertToMP4(blob);
          console.log('Format after conversion:', blob.type);
          
          const fileName = 'video.mp4';
          const blobUrl = URL.createObjectURL(blob);
          
          if (isMobile) {
            // Try to use share API on mobile
            const shared = await shareContent(blob, fileName);
            if (!shared) {
              // Show special message for Android explaining the format
              if (isAndroid) {
                alert('Fazendo download do vídeo em formato MP4.');
              }
              
              // Fallback to download if sharing fails
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            }
          } else {
            // Download on desktop
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        }
      });
      
      // Close button
      const closeButton = document.createElement('button');
      closeButton.className = 'preview-button close-button';
      closeButton.textContent = 'Fechar';
      closeButton.addEventListener('click', () => {
        previewContainer.style.display = 'none';
      });
      
      previewControls.appendChild(actionButton);
      previewControls.appendChild(closeButton);
      previewContainer.appendChild(previewControls);
      
      // Show preview container
      previewContainer.style.display = 'flex';
    }

    // Capture button event listener
    captureButton.addEventListener('click', () => {
      if (captureMode === 'photo') {
        capturePhoto();
      } else {
        if (isRecording) {
          stopRecording();
        } else {
          startRecording();
        }
      }
    });

    // Camera flip button event listener - different behavior between mobile and desktop
    const handleCameraFlip = async () => {
      if (isMobile) {
        // On mobile: switch between front and back cameras using the new function
        await switchCamera();
      } else {
        // On desktop: just mirror the image
        loadingIndicator.style.display = 'flex';
        loadingIndicator.querySelector('p')!.textContent = 'Adjusting camera...';
        
        try {
          isMirrored = !isMirrored;
          liveRenderTarget.style.transform = isMirrored ? 'scaleX(-1)' : 'scaleX(1)';
          
          // If lens was active, reapply it
          if (lensActive && lens) {
            await session.applyLens(lens);
          }
        } catch (error) {
          console.error('Error mirroring camera:', error);
        } finally {
          loadingIndicator.style.display = 'none';
        }
      }
    };

    cameraFlipButton.addEventListener('click', handleCameraFlip);

    // Update loading message
    loadingIndicator.querySelector('p')!.textContent = 'Loading lens...';
    
    // Load the lens
    const lens = await cameraKit.lensRepository.loadLens(
      '1c07333c-eae9-4401-977a-7afa863e65f6', //'<YOUR_LENS_ID>',
      '32d7c9c1-4270-4476-a1a9-020f1dbfa383' //'<YOUR_LENS_GROUP_ID>'
       
    );

    // Apply lens initially with optimized settings
    await session.applyLens(lens);
    let lensActive = true;

    // CSS fix to prevent unwanted zoom (add to existing style.css or add inline)
    const styleFixForZoom = document.createElement('style');
    styleFixForZoom.textContent = `
      #canvas {
        object-fit: cover !important; 
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
      }
      .camera-container {
        overflow: hidden;
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
      }
    `;
    document.head.appendChild(styleFixForZoom);

    // Hide loading indicator
    loadingIndicator.style.display = 'none';

  } catch (error) {
    console.error('Error initializing Camera Kit:', error);
    loadingIndicator.innerHTML = '<p class="error">Error initializing Camera Kit. Please check your API token and try again.</p>';
  }
})();
